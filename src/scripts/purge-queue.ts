/**
 * Script para LIMPAR TOTALMENTE a fila do RabbitMQ
 * 
 * ATENÇÃO: Este script remove TODAS as mensagens da fila!
 * 
 * Uso: npm run purge-queue
 */

import 'dotenv/config';
import { getQueueStatus, closeConnection } from '../services/rabbitMQ.service';
import { RABBITMQ_CONFIG } from '../config/rabbitmq.config';
import { createLogger } from '../utils/logger.utils';
import amqp from 'amqplib';
import * as readline from 'readline';

const logger = createLogger('PurgeQueue');

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
 * Conecta ao RabbitMQ e retorna o canal
 */
async function getConnection() {
  const connection = await amqp.connect(RABBITMQ_CONFIG.url);
  const channel = await connection.createChannel();
  
  // Garante que a fila existe
  await channel.assertQueue(RABBITMQ_CONFIG.queues.VIDEO_SUGGESTIONS, {
    durable: true
  });
  
  return { connection, channel };
}

/**
 * Função principal
 */
async function main() {
  let connection: amqp.Connection | null = null;
  let channel: amqp.Channel | null = null;

  try {
    console.clear();
    console.log('\n🗑️  LIMPAR FILA DO RABBITMQ\n');
    console.log('⚠️  ATENÇÃO: Este script remove TODAS as mensagens da fila!\n');

    // Verifica status da fila
    logger.info('📊 Verificando status da fila...\n');
    
    const queueInfo = await getQueueStatus();
    const messageCount = queueInfo.videoSuggestions.messageCount;
    const consumerCount = queueInfo.videoSuggestions.consumerCount;

    console.log('='.repeat(60));
    console.log('📊 STATUS ATUAL DA FILA');
    console.log('='.repeat(60));
    console.log(`📋 Nome da fila: ${RABBITMQ_CONFIG.queues.VIDEO_SUGGESTIONS}`);
    console.log(`📨 Mensagens na fila: ${messageCount}`);
    console.log(`👥 Consumidores ativos: ${consumerCount}`);
    console.log('='.repeat(60) + '\n');

    if (messageCount === 0) {
      console.log('✅ A fila já está vazia! Nada para limpar.\n');
      rl.close();
      return;
    }

    // Aviso de segurança
    console.log('⚠️  AVISO DE SEGURANÇA:');
    console.log(`   • ${messageCount} mensagem(ns) será(ão) PERMANENTEMENTE removida(s)`);
    console.log('   • Esta ação NÃO pode ser desfeita');
    console.log('   • Os vídeos NO MONGODB não serão afetados\n');

    // Confirmação 1
    const confirm1 = await question('Digite "LIMPAR" para continuar ou "N" para cancelar: ');
    
    if (confirm1.toUpperCase() !== 'LIMPAR') {
      console.log('\n❌ Operação cancelada pelo usuário.\n');
      rl.close();
      return;
    }

    // Confirmação 2 (dupla confirmação para segurança)
    console.log('\n⚠️  ÚLTIMA CONFIRMAÇÃO!\n');
    const confirm2 = await question(`Tem certeza que deseja remover ${messageCount} mensagem(ns)? (SIM/NAO): `);
    
    if (confirm2.toUpperCase() !== 'SIM') {
      console.log('\n❌ Operação cancelada pelo usuário.\n');
      rl.close();
      return;
    }

    // Limpa a fila
    console.log('\n🗑️  Limpando fila...\n');
    
    const { connection: conn, channel: ch } = await getConnection();
    connection = conn;
    channel = ch;

    const purgeResult = await channel.purgeQueue(RABBITMQ_CONFIG.queues.VIDEO_SUGGESTIONS);
    
    console.log('='.repeat(60));
    console.log('✅ FILA LIMPA COM SUCESSO!');
    console.log('='.repeat(60));
    console.log(`🗑️  Mensagens removidas: ${purgeResult.messageCount}`);
    console.log(`📋 Fila: ${RABBITMQ_CONFIG.queues.VIDEO_SUGGESTIONS}`);
    console.log('='.repeat(60) + '\n');

    logger.success(`🎉 Fila limpa! ${purgeResult.messageCount} mensagens removidas.`);

  } catch (error: any) {
    console.log('\n');
    logger.error('❌ Erro ao limpar fila:', error.message);
    console.log('\nPossíveis causas:');
    console.log('  • RabbitMQ não está acessível');
    console.log('  • Credenciais inválidas no .env');
    console.log('  • Problemas de rede\n');
  } finally {
    rl.close();
    
    // Fecha conexões
    try {
      if (channel) await channel.close();
      if (connection) await connection.close();
    } catch (error) {
      // Ignora erros ao fechar
    }
    
    await closeConnection();
    process.exit(0);
  }
}

// Tratamento de CTRL+C
process.on('SIGINT', () => {
  console.log('\n\n❌ Operação cancelada pelo usuário (CTRL+C).\n');
  rl.close();
  process.exit(0);
});

// Executa
main();
