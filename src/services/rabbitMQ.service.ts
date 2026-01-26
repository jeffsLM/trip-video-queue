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

  } catch (error: any) {
    isConnecting = false;
    connectionRetries++;
    
    const errorMsg = getRabbitMQErrorMessage(error);

    if (connectionRetries >= RABBITMQ_CONFIG.maxRetries) {
      logger.error(`❌ Falha ao conectar após ${RABBITMQ_CONFIG.maxRetries} tentativas: ${errorMsg}`);
      connectionRetries = 0;
      
      // Lança erro com mensagem amigável
      const friendlyError = new Error(errorMsg);
      friendlyError.name = 'RabbitMQConnectionError';
      throw friendlyError;
    }

    logger.warn(`⚠️ Tentativa ${connectionRetries} falhou: ${errorMsg}`);
    logger.info(`⏳ Tentando novamente em ${RABBITMQ_CONFIG.reconnectDelay}ms...`);
    await new Promise(resolve => setTimeout(resolve, RABBITMQ_CONFIG.reconnectDelay));

    return getLazyConnection();
  }
}

/**
 * Identifica o tipo de erro do RabbitMQ e retorna mensagem amigável
 */
function getRabbitMQErrorMessage(error: any): string {
  const errorString = error.toString();
  
  // Erro de conexão
  if (errorString.includes('ECONNREFUSED')) {
    return '🔴 [RABBITMQ] Servidor RabbitMQ não está acessível. Verifique se o serviço está rodando';
  }
  
  // Erro de autenticação
  if (errorString.includes('ACCESS_REFUSED') || errorString.includes('403')) {
    return '🔴 [RABBITMQ] Erro de autenticação. Verifique usuário e senha no .env';
  }
  
  // Erro de timeout
  if (errorString.includes('ETIMEDOUT')) {
    return '🔴 [RABBITMQ] Timeout ao conectar com RabbitMQ. Verifique conexão de rede';
  }
  
  // Erro de canal/fila
  if (errorString.includes('Channel') || errorString.includes('Queue')) {
    return '🔴 [RABBITMQ] Erro no canal ou fila. O canal pode ter sido fechado';
  }
  
  return `🔴 [RABBITMQ] Erro desconhecido: ${errorString.substring(0, 200)}`;
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
      throw new Error('🔴 [RABBITMQ] Fila cheia ou canal bloqueado - falha ao enviar mensagem');
    }

    logger.info(`📤 Vídeo publicado na fila video-suggestions: ${payload.url.substring(0, 50)}...`);

  } catch (error: any) {
    const errorMsg = getRabbitMQErrorMessage(error);
    logger.error(errorMsg);
    
    // Lança erro com mensagem amigável
    const friendlyError = new Error(errorMsg);
    friendlyError.name = 'RabbitMQError';
    throw friendlyError;
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
