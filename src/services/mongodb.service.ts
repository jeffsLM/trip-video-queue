import { MongoClient, Db, ObjectId } from 'mongodb';
import { MONGODB_CONFIG } from '../config/mongodb.config';
import { createLogger } from '../utils/logger.utils';

const logger = createLogger('MongoDB');

let client: MongoClient | null = null;
let db: Db | null = null;

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

export async function connectMongo(): Promise<Db> {
  if (db) return db;

  try {
    logger.info('Conectando ao MongoDB...');
    client = new MongoClient(MONGODB_CONFIG.uri, MONGODB_CONFIG.options);
    await client.connect();
    db = client.db(MONGODB_CONFIG.database);

    // Criar índice único em messageId para prevenir duplicatas
    await db.collection('video_suggestions').createIndex(
      { messageId: 1 },
      { unique: true }
    );

    logger.success(`Conectado ao MongoDB: ${MONGODB_CONFIG.database}`);
    return db;
  } catch (error) {
    logger.error('Erro ao conectar ao MongoDB:', error);
    throw error;
  }
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
      const db = await connectMongo();
      const existing = await db.collection<VideoSuggestion>('video_suggestions').findOne({ messageId: data.messageId });
      if (existing) {
        return existing;
      }
    }
    logger.error('Erro ao salvar no MongoDB:', error);
    throw error;
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
