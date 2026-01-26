import dotenv from 'dotenv';
dotenv.config();

const RABBITMQ_CONFIG = {
  url: process.env.RABBITMQ_URL || 'amqp://localhost',
  reconnectDelay: parseInt(process.env.RABBITMQ_RECONNECT_DELAY || '5000'),
  maxRetries: parseInt(process.env.RABBITMQ_MAX_RETRIES || '5'),
  queues: {
    TO_WHATSAPP: process.env.TO_WHATSAPP_QUEUE || 'to-whatsapp',
    FROM_WHATSAPP: process.env.FROM_WHATSAPP_QUEUE || 'from-whatsapp'
  }
} as const;

const QUEUE_CONFIG = {
  durable: true,
  persistent: true,
  prefetch: 1
};

export { RABBITMQ_CONFIG, QUEUE_CONFIG };
