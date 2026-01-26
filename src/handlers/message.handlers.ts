import { MessagesUpsert } from '../types';
import { createLogger } from '../utils/logger.utils';
import { saveVideoSuggestion, markAsPublished } from '../services/mongodb.service';
import { publishVideoSuggestion } from '../services/rabbitMQ.service';
import { getSystemStatus } from '../commands/status.command';
import { sendErrorNotification } from '../utils/error-notification.utils';
import dotenv from 'dotenv';

dotenv.config();

const logger = createLogger('MessageHandler');

// JID para notificações de erro (pode ser diferente do grupo de sugestões)
const ERROR_NOTIFICATION_JID = process.env.ERROR_NOTIFICATION_JID || process.env.TARGET_GROUP_ID;

const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;

const processedMessages = new Map<string, number>();
const CACHE_DURATION = 5 * 60 * 1000;
const CLEANUP_INTERVAL = 60 * 1000;

// Limpa cache de mensagens antigas
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processedMessages.entries()) {
    if (now - timestamp > CACHE_DURATION) {
      processedMessages.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

function isAllowedGroup(remoteJid: string | null | undefined): boolean {
  return remoteJid === TARGET_GROUP_ID;
}

function isDuplicateMessage(messageId: string): boolean {
  if (processedMessages.has(messageId)) {
    logger.info(`Mensagem duplicada ignorada: ${messageId}`);
    return true;
  }
  processedMessages.set(messageId, Date.now());
  return false;
}

/**
 * Extrai URL de vídeo da mensagem
 * Suporta: YouTube Shorts, TikTok, Instagram Reels, YouTube normal
 */
function extractVideoUrl(text: string): string | null {
  // Padrões de URL para cada plataforma
  const patterns = [
    // YouTube Shorts
    /https?:\/\/(www\.)?(youtube\.com\/shorts\/[a-zA-Z0-9_-]+|youtu\.be\/[a-zA-Z0-9_-]+)/i,
    // YouTube normal
    /https?:\/\/(www\.)?(youtube\.com\/watch\?v=[a-zA-Z0-9_-]+|youtu\.be\/[a-zA-Z0-9_-]+)/i,
    // TikTok
    /https?:\/\/(www\.)?(tiktok\.com\/@[a-zA-Z0-9._]+\/video\/[0-9]+|vm\.tiktok\.com\/[a-zA-Z0-9]+)/i,
    // Instagram Reels
    /https?:\/\/(www\.)?instagram\.com\/(reel|p)\/[a-zA-Z0-9_-]+/i,
    // Facebook Watch
    /https?:\/\/(www\.)?(facebook\.com\/watch\/?\?v=[0-9]+|fb\.watch\/[a-zA-Z0-9_-]+)/i,
    // Twitter/X Video
    /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/[0-9]+/i,
    // Qualquer outra URL como fallback
    /https?:\/\/[^\s]+/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Limpar possíveis caracteres extras no final
      let url = match[0];
      // Remover pontuação comum no final
      url = url.replace(/[.,!?;]$/, '');
      return url;
    }
  }

  return null;
}

export async function handleMessagesUpsert({ messages, sock }: MessagesUpsert): Promise<void> {
  try {
    logger.info(`🔥 handleMessagesUpsert chamado com ${messages.length} mensagem(ns)`);
    
    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid;

      logger.info(`📨 Mensagem recebida de: ${remoteJid}`);
      logger.info(`🎯 TARGET_GROUP_ID: ${TARGET_GROUP_ID}`);

      if (!msg.message) {
        logger.info('⚠️ Mensagem sem conteúdo, ignorando');
        continue;
      }

      const messageId = `${remoteJid}_${msg.key.id}`;
      if (isDuplicateMessage(messageId)) {
        continue;
      }

      // Verificar se é do grupo autorizado
      if (!isAllowedGroup(remoteJid)) {
        logger.info(`🚫 Grupo não autorizado - ignorando: ${remoteJid}`);
        continue;
      }

      logger.info(`✅ Mensagem do grupo autorizado`);

      // Processar apenas mensagens de texto (conversation ou extendedTextMessage)
      if (msg.message.conversation || msg.message.extendedTextMessage) {
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const pushName = msg.pushName || 'Desconhecido';
        
        logger.info(`💬 Texto recebido: ${text.substring(0, 100)}`);

        // Verificar se é comando de status
        const textLower = text.toLowerCase().trim();
        if (textLower === 'status' || textLower === '/status') {
          logger.info('📊 Comando de status detectado');
          
          try {
            const statusMessage = await getSystemStatus();
            await sock.sendMessage(remoteJid!, { text: statusMessage });
            logger.success('✅ Status enviado via WhatsApp');
          } catch (error) {
            logger.error('Erro ao enviar status:', error);
            await sock.sendMessage(remoteJid!, { 
              text: 'Erro ao obter status do sistema. Verifique os logs para mais detalhes.' 
            });
          }
          continue;
        }

        // Extrair URL da mensagem
        const url = extractVideoUrl(text);
        
        if (!url) {
          logger.info('Mensagem sem URL - ignorando');
          continue;
        }

        logger.info(`🔗 URL extraída: ${url}`);

        try {
          // PASSO 1: Salvar no MongoDB (fonte da verdade - confiabilidade garantida)
          const videoData = {
            url: url,
            texto: text,
            sugeridoPor: pushName,
            messageId: msg.key.id || '',
            chatId: remoteJid || '',
            timestamp: Date.now(),
            status: 'pending' as const
          };

          let savedDoc;
          try {
            savedDoc = await saveVideoSuggestion(videoData);
            logger.success(`✅ Salvo no MongoDB: ${savedDoc._id}`);
          } catch (mongoError: any) {
            // Erro específico do MongoDB
            const errorMsg = mongoError.message || mongoError.toString();
            logger.error(`🔴 [WHATSAPP → MONGODB] Falha ao salvar vídeo no banco de dados: ${errorMsg}`);
            
            // Reagir com ❌
            try {
              await sock.sendMessage(remoteJid!, { 
                react: { text: '❌', key: msg.key } 
              });
            } catch (reactError) {
              logger.error('🔴 [WHATSAPP] Erro ao reagir com ❌:', reactError);
            }
            
            // Enviar notificação de erro no WhatsApp
            if (ERROR_NOTIFICATION_JID) {
              await sendErrorNotification(sock, ERROR_NOTIFICATION_JID, {
                type: 'MONGODB',
                operation: 'salvar vídeo sugerido',
                message: errorMsg
              });
            }
            
            // Não continua o fluxo se falhou no MongoDB
            continue;
          }

          // PASSO 2: Publicar na fila video-suggestions (event-driven)
          try {
            await publishVideoSuggestion({
              url: savedDoc.url,
              texto: savedDoc.texto,
              sugeridoPor: savedDoc.sugeridoPor
            });
            logger.success(`✅ Publicado na fila video-suggestions`);
          } catch (rabbitError: any) {
            // Erro específico do RabbitMQ
            const errorMsg = rabbitError.message || rabbitError.toString();
            logger.error(`🔴 [WHATSAPP → RABBITMQ] Falha ao publicar na fila: ${errorMsg}`);
            
            // Enviar notificação de erro no WhatsApp
            if (ERROR_NOTIFICATION_JID) {
              await sendErrorNotification(sock, ERROR_NOTIFICATION_JID, {
                type: 'RABBITMQ',
                operation: 'publicar vídeo na fila',
                message: errorMsg
              });
            }
            
            // Continua mesmo com erro no RabbitMQ (já está salvo no MongoDB)
            // O replay pode pegar depois
          }

          // PASSO 3: Marcar como publicado no MongoDB
          try {
            await markAsPublished(savedDoc.messageId);
          } catch (markError: any) {
            // Não crítico, apenas loga
            logger.warn(`⚠️ [MONGODB] Falha ao marcar como publicado: ${markError.message}`);
          }

          // PASSO 4: Reagir com ✅ - sucesso
          try {
            await sock.sendMessage(remoteJid!, { 
              react: { text: '✅', key: msg.key } 
            });
            logger.success(`✅ [WHATSAPP] Reação enviada com sucesso`);
          } catch (reactError: any) {
            logger.error(`🔴 [WHATSAPP] Erro ao reagir com ✅: ${reactError.message}`);
          }

        } catch (error: any) {
          // Erro genérico não capturado (não deveria chegar aqui)
          const errorMsg = error.message || error.toString();
          logger.error(`🔴 [WHATSAPP] Erro crítico ao processar mensagem: ${errorMsg}`);
          
          // Reagir com ❌ - falha
          try {
            await sock.sendMessage(remoteJid!, { 
              react: { text: '❌', key: msg.key } 
            });
          } catch (reactError) {
            logger.error('🔴 [WHATSAPP] Erro ao reagir com ❌:', reactError);
          }
        }

        continue;
      }

      // Outros tipos de mensagem (vídeo, imagem, etc)
      if (msg.message.videoMessage) {
        logger.info(`🎥 Vídeo recebido - processamento futuro`);
        continue;
      }

      if (msg.message.imageMessage) {
        logger.info(`🖼️ Imagem recebida - processamento futuro`);
        continue;
      }

      logger.info(`⚠️ Tipo de mensagem não suportado ainda`);
    }
  } catch (error) {
    logger.error('❌ ERRO CRÍTICO em handleMessagesUpsert:', error);
  }
}
