import type {
  ConnectionUpdate,
  WhatsappSocket,
} from '../types';
import { Boom } from '@hapi/boom';
import { DisconnectReason } from '@whiskeysockets/baileys';
import { generateQRCode } from '../utils/whatsapp.utils';

import dotenv from 'dotenv';
import { createLogger } from '../utils/logger.utils';
dotenv.config();

const logger = createLogger('WhatsAppHandler');

interface IWhatsAppHandlers {
  update: ConnectionUpdate,
  reconnectCallback: () => void,
}

export function handleConnectionUpdate({ update, reconnectCallback }: IWhatsAppHandlers): void {
  if (update.qr) {
    generateQRCode(update.qr);
  }

  const { connection, lastDisconnect } = update;

  if (connection === 'open') {
    logger.success('✅ Conectado ao WhatsApp!');
    return;
  }

  if (connection === 'close') {
    const shouldReconnect =
      lastDisconnect?.error instanceof Boom &&
      lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;

    logger.error('Conexão fechada:', lastDisconnect?.error, ', reconectando:', shouldReconnect);
    if (shouldReconnect) reconnectCallback();
  }
}
