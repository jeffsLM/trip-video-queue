import { connectToWhatsApp } from './services/whatsapp.service';
import { createLogger } from './utils/logger.utils';

const logger = createLogger('Main');

async function main(): Promise<void> {
  try {
    logger.info('Iniciando conexão com WhatsApp...');
    await connectToWhatsApp();

    process.on('SIGINT', () => {
      logger.info('\n👋 Saindo...');
      process.exit(0);
    });
  } catch (error) {
    logger.error('❌ Erro ao conectar:', error);
  }
}

main();
