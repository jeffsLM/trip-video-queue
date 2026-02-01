/**
 * Script para reenviar vídeos do MongoDB para a fila RabbitMQ
 * 
 * Uso:
 * - npm run replay -- --count 1      (envia 1 registro)
 * - npm run replay -- --count 2      (envia 2 registros)
 * - npm run replay -- --all          (envia todos os registros)
 * - npm run replay -- --not-published (envia apenas não publicados)
 */

import 'dotenv/config';
import { connectMongo, VideoSuggestion, closeConnection as closeMongoConnection } from '../services/mongodb.service';
import { publishVideoSuggestion, closeConnection as closeRabbitConnection } from '../services/rabbitMQ.service';
import { createLogger } from '../utils/logger.utils';
import { ObjectId } from 'mongodb';

const logger = createLogger('ReplayQueue');

interface ReplayOptions {
  count?: number;          // Quantidade de registros para enviar
  all?: boolean;           // Enviar todos
  notPublished?: boolean;  // Apenas não publicados
}

/**
 * Busca vídeos do MongoDB baseado nos filtros
 */
async function fetchVideos(options: ReplayOptions): Promise<VideoSuggestion[]> {
  const db = await connectMongo();
  const collection = db.collection<VideoSuggestion>('video_suggestions');

  // Filtro base
  const filter: any = {};

  // Se não publicados, adiciona filtro
  if (options.notPublished) {
    filter.publishedToQueue = { $ne: true };
  }

  // Define o limite
  let limit = 0;
  if (options.count && options.count > 0) {
    limit = options.count;
  }

  // Busca documentos
  const query = collection.find(filter).sort({ createdAt: 1 });
  
  if (limit > 0) {
    query.limit(limit);
  }

  const videos = await query.toArray();
  return videos;
}

/**
 * Envia um vídeo para a fila
 */
async function sendToQueue(video: VideoSuggestion): Promise<boolean> {
  try {
    // ✅ Garantir que messageId existe (gerar fallback se necessário)
    const messageId = video.messageId && video.messageId.trim() !== '' 
      ? video.messageId 
      : `replay_${video._id}_${Date.now()}`;

    if (!video.messageId || video.messageId.trim() === '') {
      logger.warn(`⚠️ Vídeo sem messageId, gerando fallback: ${messageId}`);
      
      // Atualiza no MongoDB com o novo messageId
      const db = await connectMongo();
      await db.collection('video_suggestions').updateOne(
        { _id: video._id },
        { $set: { messageId: messageId } }
      );
    }

    await publishVideoSuggestion({
      url: video.url,
      texto: video.texto,
      sugeridoPor: video.sugeridoPor,
      messageId: messageId
    });

    // Marca como publicado
    const db = await connectMongo();
    await db.collection('video_suggestions').updateOne(
      { _id: video._id },
      {
        $set: {
          publishedToQueue: true,
          publishedAt: new Date()
        }
      }
    );

    return true;
  } catch (error: any) {
    logger.error(`Erro ao enviar vídeo ${video._id}: ${error.message}`);
    return false;
  }
}

/**
 * Função principal
 */
async function main() {
  try {
    // Parse argumentos
    const args = process.argv.slice(2);
    const options: ReplayOptions = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      if (arg === '--count') {
        const countValue = parseInt(args[i + 1], 10);
        if (isNaN(countValue) || countValue < 1) {
          throw new Error('--count deve ser um número maior que 0');
        }
        options.count = countValue;
        i++; // Pula o próximo argumento
      } else if (arg === '--all') {
        options.all = true;
      } else if (arg === '--not-published') {
        options.notPublished = true;
      }
    }

    // Validação
    if (!options.count && !options.all) {
      console.log('\n❌ Uso incorreto!\n');
      console.log('Exemplos de uso:');
      console.log('  npm run replay -- --count 1          (envia 1 vídeo)');
      console.log('  npm run replay -- --count 2          (envia 2 vídeos)');
      console.log('  npm run replay -- --all              (envia todos)');
      console.log('  npm run replay -- --all --not-published  (envia todos não publicados)');
      console.log('  npm run replay -- --count 5 --not-published  (envia 5 não publicados)\n');
      process.exit(1);
    }

    logger.info('🚀 Iniciando replay de vídeos para a fila...\n');

    // Busca vídeos
    logger.info('📋 Buscando vídeos no MongoDB...');
    const videos = await fetchVideos(options);

    if (videos.length === 0) {
      logger.warn('⚠️ Nenhum vídeo encontrado com os filtros especificados');
      process.exit(0);
    }

    logger.success(`✅ ${videos.length} vídeo(s) encontrado(s)\n`);

    // Mostra preview dos vídeos
    console.log('📹 Vídeos que serão enviados:\n');
    videos.forEach((video, index) => {
      const status = video.publishedToQueue ? '✓ Publicado' : '○ Não publicado';
      console.log(`${index + 1}. [${status}] ${video.url.substring(0, 60)}...`);
      console.log(`   Sugerido por: ${video.sugeridoPor}`);
      console.log(`   Data: ${video.createdAt.toLocaleString('pt-BR')}\n`);
    });

    // Confirmação
    console.log('⚠️  Deseja enviar estes vídeos para a fila? (pressione CTRL+C para cancelar)');
    console.log('⏳ Enviando em 3 segundos...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Envia para a fila
    logger.info('📤 Enviando vídeos para a fila...\n');
    
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const index = i + 1;
      
      logger.info(`[${index}/${videos.length}] Enviando: ${video.url.substring(0, 50)}...`);
      
      const success = await sendToQueue(video);
      
      if (success) {
        successCount++;
        logger.success(`✅ [${index}/${videos.length}] Enviado com sucesso`);
      } else {
        failCount++;
        logger.error(`❌ [${index}/${videos.length}] Falha ao enviar`);
      }
      
      // Pequena pausa entre envios
      if (i < videos.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Resultado final
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESULTADO FINAL');
    console.log('='.repeat(60));
    console.log(`✅ Sucesso: ${successCount}`);
    console.log(`❌ Falhas: ${failCount}`);
    console.log(`📝 Total: ${videos.length}`);
    console.log('='.repeat(60) + '\n');

    logger.success('🎉 Replay concluído!');

  } catch (error: any) {
    logger.error('❌ Erro fatal:', error.message);
    process.exit(1);
  } finally {
    // Fecha conexões silenciosamente (ignora erros se não conectou)
    await Promise.allSettled([
      closeMongoConnection(),
      closeRabbitConnection()
    ]);
    process.exit(0);
  }
}

// Executa
main();
