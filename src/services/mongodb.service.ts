import { MongoClient, Db, ObjectId, MongoServerError } from 'mongodb';
import { MONGODB_CONFIG } from '../config/mongodb.config';
import { createLogger } from '../utils/logger.utils';

const logger = createLogger('MongoDB');

let client: MongoClient | null = null;
let db: Db | null = null;
let isConnecting = false;

export interface VideoSuggestion {
  url: string;
  texto: string;
  sugeridoPor: string;
  messageId: string;
  chatId: string;
  timestamp: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  publishedToQueue: boolean;
  iaProcess: boolean;
  createdAt: Date;
  publishedAt?: Date;
  _id?: ObjectId;
}

/**
 * Identifica o tipo de erro do MongoDB e retorna mensagem amigável
 */
function getMongoErrorMessage(error: any): string {
  const errorString = error.toString();
  
  // Erro de SSL/TLS
  if (errorString.includes('SSL') || errorString.includes('TLS') || errorString.includes('tlsv1')) {
    return '🔴 [MONGODB] Erro de certificado SSL/TLS ao conectar com MongoDB Atlas. Verifique: 1) Conexão com internet, 2) IP autorizado no Atlas, 3) Certificados do sistema';
  }
  
  // Erro de autenticação
  if (errorString.includes('Authentication') || errorString.includes('auth')) {
    return '🔴 [MONGODB] Erro de autenticação. Verifique usuário e senha no .env';
  }
  
  // Erro de rede/timeout
  if (errorString.includes('ENOTFOUND') || errorString.includes('ETIMEDOUT') || errorString.includes('ECONNREFUSED')) {
    return '🔴 [MONGODB] Erro de rede ao conectar com MongoDB. Verifique conexão com internet';
  }
  
  // Erro de Server Selection (nenhum servidor disponível)
  if (errorString.includes('MongoServerSelectionError')) {
    return '🔴 [MONGODB] Nenhum servidor MongoDB disponível. Verifique: 1) String de conexão, 2) IP autorizado no Atlas, 3) Cluster ativo';
  }
  
  return `🔴 [MONGODB] Erro desconhecido: ${errorString.substring(0, 200)}`;
}

/**
 * Conecta ao MongoDB com retry automático
 */
export async function connectMongo(retries = 3, delayMs = 5000): Promise<Db> {
  // Se já conectado, retorna
  if (db && client) {
    try {
      // Testa se conexão está ativa
      await client.db('admin').admin().ping();
      return db;
    } catch (error) {
      logger.warn('Conexão MongoDB inativa, reconectando...');
      db = null;
      client = null;
    }
  }

  // Previne múltiplas tentativas simultâneas
  if (isConnecting) {
    logger.info('Aguardando conexão em andamento...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (db) return db;
  }

  isConnecting = true;
  let lastError: any;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`🔄 Tentativa ${attempt}/${retries} - Conectando ao MongoDB...`);
      
      client = new MongoClient(MONGODB_CONFIG.uri, MONGODB_CONFIG.options);
      await client.connect();
      
      // Testa conexão
      await client.db('admin').admin().ping();
      
      db = client.db(MONGODB_CONFIG.database);

      // Criar índice único em messageId para prevenir duplicatas
      await db.collection('video_suggestions').createIndex(
        { messageId: 1 },
        { unique: true }
      );

      logger.success(`✅ Conectado ao MongoDB: ${MONGODB_CONFIG.database} (tentativa ${attempt})`);
      isConnecting = false;
      return db;
      
    } catch (error: any) {
      lastError = error;
      const errorMsg = getMongoErrorMessage(error);
      logger.error(`❌ Tentativa ${attempt}/${retries} falhou:`, errorMsg);
      
      // Limpa cliente em caso de erro
      if (client) {
        try {
          await client.close();
        } catch (closeError) {
          // Ignora erro ao fechar
        }
      }
      client = null;
      db = null;

      // Se não for a última tentativa, aguarda antes de tentar novamente
      if (attempt < retries) {
        logger.info(`⏳ Aguardando ${delayMs / 1000}s antes da próxima tentativa...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  isConnecting = false;
  const finalError = new Error(getMongoErrorMessage(lastError));
  logger.error('❌ Todas as tentativas de conexão falharam');
  throw finalError;
}

export async function saveVideoSuggestion(data: Omit<VideoSuggestion, '_id' | 'publishedToQueue' | 'iaProcess' | 'createdAt'>): Promise<VideoSuggestion> {
  try {
    const db = await connectMongo();
    const collection = db.collection<VideoSuggestion>('video_suggestions');

    const doc: Omit<VideoSuggestion, '_id'> = {
      ...data,
      publishedToQueue: false, // Flag para replay
      iaProcess: false,
      createdAt: new Date()
    };

    const result = await collection.insertOne(doc as any);

    logger.info(`✅ Vídeo salvo no MongoDB: ${data.url.substring(0, 50)}...`);

    return { ...doc, _id: result.insertedId } as VideoSuggestion;
  } catch (error: any) {
    // Se for erro de duplicata (messageId único), retornar documento existente
    if (error.code === 11000) {
      logger.warn(`Mensagem duplicada detectada: ${data.messageId}`);
      try {
        const db = await connectMongo();
        const existing = await db.collection<VideoSuggestion>('video_suggestions').findOne({ messageId: data.messageId });
        if (existing) {
          return existing;
        }
      } catch (findError) {
        logger.error('Erro ao buscar documento duplicado:', getMongoErrorMessage(findError));
      }
    }
    
    // Erro de conexão/SSL
    const errorMsg = getMongoErrorMessage(error);
    logger.error('❌ Erro ao salvar no MongoDB:', errorMsg);
    
    // Lança erro com mensagem amigável
    const friendlyError = new Error(errorMsg);
    friendlyError.name = 'MongoDBError';
    throw friendlyError;
  }
}

export async function markAsPublished(messageId: string): Promise<void> {
  try {
    const db = await connectMongo();
    await db.collection('video_suggestions').updateOne(
      { messageId },
      {
        $set: {
          publishedToQueue: true,
          publishedAt: new Date()
        }
      }
    );
    logger.info(`✅ Vídeo marcado como publicado na fila: ${messageId}`);
  } catch (error) {
    logger.error('Erro ao marcar como publicado:', error);
    throw error;
  }
}

export async function findById(id: string | ObjectId): Promise<VideoSuggestion | null> {
  try {
    const db = await connectMongo();
    const objectId = typeof id === 'string' ? new ObjectId(id) : id;
    const doc = await db.collection<VideoSuggestion>('video_suggestions').findOne({ _id: objectId });
    return doc;
  } catch (error) {
    logger.error('Erro ao buscar por ID:', error);
    throw error;
  }
}

export async function closeConnection(): Promise<void> {
  if (client) {
    try {
      await client.close();
      client = null;
      db = null;
      logger.success('Conexão com MongoDB fechada');
    } catch (error) {
      logger.error('Erro ao fechar conexão:', error);
    }
  }
}
