import dotenv from 'dotenv';
dotenv.config();

const RABBITMQ_CONFIG = {
  url: process.env.RABBITMQ_URL || 'amqp://localhost',
  reconnectDelay: parseInt(process.env.RABBITMQ_RECONNECT_DELAY || '5000'),
  maxRetries: parseInt(process.env.RABBITMQ_MAX_RETRIES || '5'),
  queues: {
    VIDEO_SUGGESTIONS: 'video-suggestions' // Fila para event-driven de vídeos
  }
} as const;

const QUEUE_CONFIG = {
  durable: true,
  persistent: true,
  prefetch: 1
};

export { RABBITMQ_CONFIG, QUEUE_CONFIG };
