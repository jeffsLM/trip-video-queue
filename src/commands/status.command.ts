import { connectMongo } from '../services/mongodb.service';
import { getQueueStatus, isConnected } from '../services/rabbitMQ.service';
import { createLogger } from '../utils/logger.utils';

const logger = createLogger('StatusCommand');

export async function getSystemStatus(): Promise<string> {
  const statusLines: string[] = [];
  
  statusLines.push('*STATUS DO SISTEMA*\n');
  statusLines.push('━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // 1. MongoDB
    try {
      const db = await connectMongo();
      const collections = await db.listCollections().toArray();
      const count = await db.collection('video_suggestions').countDocuments();
      
      statusLines.push('\n*MongoDB*');
      statusLines.push(`Status: Conectado`);
      statusLines.push(`Registros: ${count}`);
      statusLines.push(`Coleções ativas: ${collections.length}`);
    } catch (error: any) {
      statusLines.push('\n*MongoDB*');
      statusLines.push(`Status: Erro de conexão`);
      statusLines.push(`Detalhes: ${error.message.substring(0, 50)}`);
    }

    // 2. RabbitMQ
    try {
      const queueStatus = await getQueueStatus();
      const connected = isConnected();
      
      statusLines.push('\n*RabbitMQ*');
      statusLines.push(`Status: ${connected ? 'Conectado' : 'Desconectado'}`);
      statusLines.push(`Fila: video-suggestions`);
      statusLines.push(`Mensagens pendentes: ${queueStatus.videoSuggestions.messageCount}`);
      statusLines.push(`Consumidores ativos: ${queueStatus.videoSuggestions.consumerCount}`);
      
      if (queueStatus.videoSuggestions.messageCount > 50) {
        statusLines.push(`Atenção: ${queueStatus.videoSuggestions.messageCount} mensagens aguardando processamento`);
      }
    } catch (error: any) {
      statusLines.push('\n*RabbitMQ*');
      statusLines.push(`Status: Erro de conexão`);
      statusLines.push(`Detalhes: ${error.message.substring(0, 50)}`);
    }

    // 3. Sistema
    statusLines.push('\n*Sistema*');
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    statusLines.push(`Tempo ativo: ${hours}h ${minutes}m`);
    statusLines.push(`Uso de memória: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
    statusLines.push(`Node.js: ${process.version}`);

    statusLines.push('\n━━━━━━━━━━━━━━━━━━━━━━━━');
    statusLines.push('Sistema operacional');

  } catch (error: any) {
    logger.error('Erro ao obter status:', error);
    statusLines.push('\nErro ao verificar status do sistema');
    statusLines.push(`Detalhes: ${error.message}`);
  }

  return statusLines.join('\n');
}
