/**
 * Script SIMPLES e INTERATIVO para reenviar vídeos do MongoDB para a fila RabbitMQ
 * 
 * Uso: npm run replay-simple
 * 
 * O script vai perguntar quantos vídeos você quer enviar!
 */

import 'dotenv/config';
import { connectMongo, VideoSuggestion, closeConnection as closeMongoConnection } from '../services/mongodb.service';
import { publishVideoSuggestion, closeConnection as closeRabbitConnection } from '../services/rabbitMQ.service';
import { createLogger } from '../utils/logger.utils';
import * as readline from 'readline';

const logger = createLogger('ReplaySimple');

// Interface para entrada do usuário
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Pergunta ao usuário
 */
function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Busca vídeos do MongoDB
 */
async function fetchVideos(limit?: number, onlyNotPublished: boolean = false): Promise<VideoSuggestion[]> {
  const db = await connectMongo();
  const collection = db.collection<VideoSuggestion>('video_suggestions');

  const filter: any = {};
  if (onlyNotPublished) {
    filter.publishedToQueue = { $ne: true };
  }

  const query = collection.find(filter).sort({ createdAt: 1 });
  
  if (limit && limit > 0) {
    query.limit(limit);
  }

  return await query.toArray();
}

/**
 * Mostra estatísticas dos vídeos
 */
async function showStats(): Promise<void> {
  const db = await connectMongo();
  const collection = db.collection<VideoSuggestion>('video_suggestions');

  const total = await collection.countDocuments();
  const published = await collection.countDocuments({ publishedToQueue: true });
  const notPublished = total - published;

  console.log('\n' + '='.repeat(60));
  console.log('📊 ESTATÍSTICAS DOS VÍDEOS');
  console.log('='.repeat(60));
  console.log(`📹 Total de vídeos: ${total}`);
  console.log(`✅ Já publicados: ${published}`);
  console.log(`○  Não publicados: ${notPublished}`);
  console.log('='.repeat(60) + '\n');
}

/**
 * Envia vídeo para a fila
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
    logger.error(`Erro ao enviar: ${error.message}`);
    return false;
  }
}

/**
 * Menu interativo
 */
async function interactiveMenu() {
  console.clear();
  console.log('\n🎬 REPLAY DE VÍDEOS PARA A FILA\n');

  // Mostra estatísticas
  await showStats();

  console.log('Escolha uma opção:\n');
  console.log('1️⃣  - Enviar 1 vídeo');
  console.log('2️⃣  - Enviar 2 vídeos');
  console.log('5️⃣  - Enviar 5 vídeos');
  console.log('🔟 - Enviar 10 vídeos');
  console.log('🌟 - Enviar TODOS os vídeos');
  console.log('⭕ - Enviar apenas NÃO publicados');
  console.log('❌ - Sair\n');

  const choice = await question('Digite sua opção (1/2/5/10/todos/nao-publicados/sair): ');

  let count: number | undefined;
  let onlyNotPublished = false;

  switch (choice.toLowerCase()) {
    case '1':
      count = 1;
      break;
    case '2':
      count = 2;
      break;
    case '5':
      count = 5;
      break;
    case '10':
      count = 10;
      break;
    case 'todos':
    case 'all':
      count = undefined; // Sem limite
      break;
    case 'nao-publicados':
    case 'nao':
    case 'not':
      count = undefined;
      onlyNotPublished = true;
      break;
    case 'sair':
    case 'exit':
    case 'q':
    case 'x':
      console.log('\n👋 Até logo!\n');
      rl.close();
      return;
    default:
      console.log('\n❌ Opção inválida!\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
      return interactiveMenu();
  }

  // Busca vídeos
  console.log('\n📋 Buscando vídeos...\n');
  const videos = await fetchVideos(count, onlyNotPublished);

  if (videos.length === 0) {
    console.log('⚠️ Nenhum vídeo encontrado!\n');
    await question('Pressione ENTER para continuar...');
    return interactiveMenu();
  }

  // Mostra preview
  console.log(`📹 ${videos.length} vídeo(s) encontrado(s):\n`);
  videos.forEach((video, index) => {
    const status = video.publishedToQueue ? '✓' : '○';
    console.log(`${index + 1}. [${status}] ${video.url.substring(0, 50)}...`);
    console.log(`   👤 ${video.sugeridoPor} | 📅 ${video.createdAt.toLocaleString('pt-BR')}\n`);
  });

  // Confirmação
  const confirm = await question(`\n⚠️  Enviar ${videos.length} vídeo(s) para a fila? (s/n): `);
  
  if (confirm.toLowerCase() !== 's' && confirm.toLowerCase() !== 'sim') {
    console.log('\n❌ Operação cancelada!\n');
    await question('Pressione ENTER para continuar...');
    return interactiveMenu();
  }

  // Envia para a fila
  console.log('\n📤 Enviando vídeos...\n');
  
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const index = i + 1;
    
    process.stdout.write(`[${index}/${videos.length}] Enviando... `);
    
    const success = await sendToQueue(video);
    
    if (success) {
      successCount++;
      console.log('✅');
    } else {
      failCount++;
      console.log('❌');
    }
    
    // Pequena pausa
    if (i < videos.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  // Resultado
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESULTADO');
  console.log('='.repeat(60));
  console.log(`✅ Sucesso: ${successCount}`);
  console.log(`❌ Falhas: ${failCount}`);
  console.log(`📝 Total: ${videos.length}`);
  console.log('='.repeat(60) + '\n');

  const continuar = await question('Deseja enviar mais vídeos? (s/n): ');
  
  if (continuar.toLowerCase() === 's' || continuar.toLowerCase() === 'sim') {
    return interactiveMenu();
  } else {
    console.log('\n👋 Até logo!\n');
    rl.close();
  }
}

/**
 * Função principal
 */
async function main() {
  try {
    await interactiveMenu();
  } catch (error: any) {
    logger.error('❌ Erro:', error.message);
  } finally {
    rl.close();
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
