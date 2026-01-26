import qrcode from 'qrcode-terminal';
import { proto, WASocket } from '@whiskeysockets/baileys';
import { createLogger } from './logger.utils';

const logger = createLogger('WhatsAppUtils');

export function generateQRCode(qr: string): void {
  logger.info('📲 Escaneie o QR code abaixo com seu WhatsApp:');
  qrcode.generate(qr, { small: true });
}

export function extractTextFromMessage(message: proto.IMessage): string {
  if (!message) return 'Mensagem vazia';

  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.documentMessage?.caption) return message.documentMessage.caption;
  if (message.buttonsResponseMessage?.selectedButtonId)
    return message.buttonsResponseMessage.selectedButtonId;

  return 'Mídia/Outro';
}

// Versão atualizada usando Interactive Messages
export async function sendMessage(
  sock: WASocket,
  jid: string,
  text: string,
  buttons: { id: string; text: string }[],
  headerText?: string
) {
  // Limita a 3 botões (limitação do WhatsApp)
  const limitedButtons = buttons.slice(0, 3);

  const interactiveMessage: proto.IMessage = {
    interactiveMessage: {
      body: { text },
      header: headerText ? { title: headerText, hasMediaAttachment: false } : undefined,
      footer: { text: 'Escolha uma opção:' },
      nativeFlowMessage: {
        buttons: limitedButtons.map(button => ({
          name: 'quick_reply',
          buttonParamsJson: JSON.stringify({
            display_text: button.text,
            id: button.id
          })
        }))
      }
    }
  };

  await sock.sendMessage(jid, interactiveMessage as any);
}
