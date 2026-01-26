import { WASocket } from '@whiskeysockets/baileys';
import { createLogger } from './logger.utils';

const logger = createLogger('ErrorNotification');

/**
 * Formata erro de forma simples para WhatsApp
 */
export function formatErrorForWhatsApp(error: {
  type: 'MONGODB' | 'RABBITMQ' | 'WHATSAPP' | 'SYSTEM';
  operation: string;
  message: string;
}): string {
  const timestamp = new Date().toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  const emojis = {
    MONGODB: '🗄️',
    RABBITMQ: '🐰',
    WHATSAPP: '💬',
    SYSTEM: '⚙️'
  };

  return `🚨 *ERRO AO ${error.operation.toUpperCase()}*\n\n` +
         `${emojis[error.type]} *Serviço:* ${error.type}\n` +
         `🕐 *Horário:* ${timestamp}\n\n` +
         `❌ *Erro encontrado:*\n${error.message}`;
}

/**
 * Envia notificação de erro simples para o WhatsApp
 */
export async function sendErrorNotification(
  sock: WASocket,
  targetJid: string,
  error: {
    type: 'MONGODB' | 'RABBITMQ' | 'WHATSAPP' | 'SYSTEM';
    operation: string;
    message: string;
  }
): Promise<boolean> {
  try {
    const formattedMessage = formatErrorForWhatsApp(error);
    await sock.sendMessage(targetJid, { text: formattedMessage });
    
    logger.success(`✅ Notificação de erro enviada`);
    return true;
  } catch (notificationError: any) {
    // NÃO lançar erro aqui para evitar loop infinito
    logger.error(`❌ Falha ao enviar notificação de erro: ${notificationError.message}`);
    return false;
  }
}
