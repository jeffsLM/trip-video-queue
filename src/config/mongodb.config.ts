import dotenv from 'dotenv';
dotenv.config();

export const MONGODB_CONFIG = {
  uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
  database: process.env.MONGODB_DATABASE || 'trip-videos',
  options: {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 30000, // 30 segundos (aumentado de 5s)
    socketTimeoutMS: 45000, // 45 segundos
    connectTimeoutMS: 30000, // 30 segundos
    retryWrites: true,
    retryReads: true,
    // Configurações TLS/SSL para MongoDB Atlas
    tls: true,
    tlsAllowInvalidCertificates: false,
    tlsAllowInvalidHostnames: false,
    // Pool e timeout settings
    maxIdleTimeMS: 60000,
    waitQueueTimeoutMS: 30000,
  }
} as const;
