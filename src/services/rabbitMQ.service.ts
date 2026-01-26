import amqp from 'amqplib';
import { QUEUE_CONFIG, RABBITMQ_CONFIG } from '../config/rabbitmq.config';
import { createLogger } from '../utils/logger.utils';

interface RabbitMQConnection {
  connection: amqp.ChannelModel;
  channel: amqp.Channel;
}

let cachedConnection: RabbitMQConnection | null = null;
let isConnecting = false;
let connectionRetries = 0;

const logger = createLogger('RabbitMQ');

async function createConnection(): Promise<RabbitMQConnection> {
  const connection = await amqp.connect(RABBITMQ_CONFIG.url);
  const channel = await connection.createChannel();

  await channel.prefetch(QUEUE_CONFIG.prefetch || 1);

  // Criar fila
  await channel.assertQueue(RABBITMQ_CONFIG.queues.VIDEO_SUGGESTIONS, {
    durable: QUEUE_CONFIG.durable
  });

  // Configurar listeners para reconexão
  connection.on('error', (error) => {
    logger.error('Erro na conexão:', error);
    cachedConnection = null;
  });

  connection.on('close', () => {
    logger.warn('Conexão fechada');
    cachedConnection = null;
  });

  channel.on('error', (error) => {
    logger.error('Erro no canal:', error);
    cachedConnection = null;
  });

  channel.on('close', () => {
    logger.warn('Canal fechado');
    cachedConnection = null;
  });

  return { connection, channel };
}

async function getLazyConnection(): Promise<RabbitMQConnection> {
  if (cachedConnection) {
    return cachedConnection;
  }

  // Se já está conectando, aguarda
  if (isConnecting) {
    while (isConnecting) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (cachedConnection) {
      return cachedConnection;
    }
  }

  isConnecting = true;

  try {
    logger.info(`Conectando ao RabbitMQ... (tentativa ${connectionRetries + 1}/${RABBITMQ_CONFIG.maxRetries})`);

    cachedConnection = await createConnection();
    connectionRetries = 0;
    isConnecting = false;

    logger.success('Conectado ao RabbitMQ via Lazy Loading');
    return cachedConnection;

  } catch (error) {
    isConnecting = false;
    connectionRetries++;

    if (connectionRetries >= RABBITMQ_CONFIG.maxRetries) {
      logger.error(`Falha ao conectar após ${RABBITMQ_CONFIG.maxRetries} tentativas:`, error);
      connectionRetries = 0;
      throw error;
    }

    logger.warn(`Tentativa ${connectionRetries} falhou, tentando novamente em ${RABBITMQ_CONFIG.reconnectDelay}ms...`);
    await new Promise(resolve => setTimeout(resolve, RABBITMQ_CONFIG.reconnectDelay));

    return getLazyConnection();
  }
}

/**
 * Publica vídeo na nova fila video-suggestions (event-driven)
 */
export async function publishVideoSuggestion(payload: {
  url: string;
  texto: string;
  sugeridoPor: string;
}): Promise<void> {
  try {
    const { channel } = await getLazyConnection();
    const messageJson = JSON.stringify(payload);
    const messageBuffer = Buffer.from(messageJson);

    const success = channel.sendToQueue(
      RABBITMQ_CONFIG.queues.VIDEO_SUGGESTIONS,
      messageBuffer,
      { persistent: QUEUE_CONFIG.persistent }
    );

    if (!success) {
      throw new Error('Falha ao enviar para fila video-suggestions');
    }

    logger.info(`📤 Vídeo publicado na fila video-suggestions: ${payload.url.substring(0, 50)}...`);

  } catch (error) {
    logger.error('Erro ao publicar na fila video-suggestions:', error);
    throw error;
  }
}

/**
 * Retorna o status da fila video-suggestions
 */
export async function getQueueStatus(): Promise<{
  videoSuggestions: amqp.Replies.AssertQueue;
}> {
  try {
    const { channel } = await getLazyConnection();

    const videoSuggestionsStatus = await channel.checkQueue(RABBITMQ_CONFIG.queues.VIDEO_SUGGESTIONS);

    return {
      videoSuggestions: videoSuggestionsStatus
    };
  } catch (error) {
    logger.error('Erro ao verificar status das filas:', error);
    throw error;
  }
}

/**
 * Verifica se está conectado ao RabbitMQ
 */
export function isConnected(): boolean {
  return cachedConnection !== null && !isConnecting;
}

/**
 * Fecha a conexão com RabbitMQ
 */
export async function closeConnection(): Promise<void> {
  if (cachedConnection) {
    try {
      await cachedConnection.channel.close();
      await cachedConnection.connection.close();
      cachedConnection = null;
      logger.success('Conexão fechada com sucesso');
    } catch (error) {
      logger.error('Erro ao fechar conexão:', error);
      cachedConnection = null; // Reset mesmo com erro
    }
  }
}
