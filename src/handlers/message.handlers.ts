import { MessagesUpsert } from '../types';
import { createLogger } from '../utils/logger.utils';
import dotenv from 'dotenv';

dotenv.config();

const logger = createLogger('MessageHandler');

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
      if (isAllowedGroup(remoteJid)) {
        logger.info(`✅ Mensagem do grupo autorizado`);

        // TODO: Adicionar handlers específicos para diferentes tipos de mensagem
        // Exemplos de tipos de mensagem disponíveis:
        // - msg.message.imageMessage - Imagens
        // - msg.message.videoMessage - Vídeos
        // - msg.message.conversation - Texto simples
        // - msg.message.extendedTextMessage - Texto com formatação/contexto
        // - msg.message.documentMessage - Documentos

        if (msg.message.videoMessage) {
          logger.info(`🎥 Vídeo recebido - processamento futuro`);
          // TODO: Implementar handler de vídeo
          continue;
        }

        if (msg.message.conversation || msg.message.extendedTextMessage) {
          const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
          logger.info(`💬 Texto recebido: ${text.substring(0, 50)}`);
          // TODO: Implementar handler de comandos de texto
          continue;
        }

        if (msg.message.imageMessage) {
          logger.info(`🖼️ Imagem recebida - processamento futuro`);
          // TODO: Implementar handler de imagem se necessário
          continue;
        }

        logger.info(`⚠️ Tipo de mensagem não suportado ainda`);
        continue;
      }

      // Grupo não autorizado
      logger.info(`🚫 Grupo não autorizado - ignorando: ${remoteJid}`);
    }
  } catch (error) {
    logger.error('❌ ERRO CRÍTICO em handleMessagesUpsert:', error);
  }
}
