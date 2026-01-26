import P from 'pino';
import * as baileys from '@whiskeysockets/baileys';
import type { WhatsappSocket } from '../types';
import {
  handleConnectionUpdate,
} from '../handlers/whatsapp.handlers';
import { WHATSAPP_CONFIG } from '../config/whatsapp.config';
import { handleMessagesUpsert } from '../handlers/message.handlers';
import { createLogger } from '../utils/logger.utils';

const makeWASocket = baileys.makeWASocket;
const { useMultiFileAuthState } = baileys;

// Logger
const logger = createLogger('WhatsApp');

// Configuração de reconexão (usando WHATSAPP_CONFIG)
const getReconnectConfig = () => WHATSAPP_CONFIG.reconnect;

// Estado de reconexão
let reconnectAttempts = 0;
let isConnecting = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let connectionHealthCheck: NodeJS.Timeout | null = null;
let lastSuccessfulConnection: Date | null = null;

// Estatísticas de conexão
const connectionStats = {
  totalReconnects: 0,
  error503Count: 0,
  error500Count: 0,
  errorTimeoutCount: 0,
  lastError: null as any,
  uptime: 0,
};

// Função auxiliar para calcular delay com backoff exponencial
function getReconnectDelay(isError503: boolean = false): number {
  const config = getReconnectConfig();
  const baseDelay = isError503 ? config.error503.initialDelay : config.initialDelay;
  const delay = Math.min(
    baseDelay * Math.pow(config.backoffMultiplier, reconnectAttempts),
    config.maxDelay
  );
  return delay;
}

// Função para obter o máximo de tentativas baseado no tipo de erro
function getMaxRetries(isError503: boolean = false): number {
  const config = getReconnectConfig();
  return isError503 ? config.error503.maxRetries : config.maxRetries;
}

// Função para registrar estatísticas de erro
function logErrorStats(statusCode?: number): void {
  if (statusCode === 503) connectionStats.error503Count++;
  if (statusCode === 500) connectionStats.error500Count++;
  connectionStats.totalReconnects++;

  logger.info(`📊 Estatísticas de Conexão:`);
  logger.info(`   - Total de reconexões: ${connectionStats.totalReconnects}`);
  logger.info(`   - Erros 503: ${connectionStats.error503Count}`);
  logger.info(`   - Erros 500: ${connectionStats.error500Count}`);
  logger.info(`   - Timeouts: ${connectionStats.errorTimeoutCount}`);
  if (lastSuccessfulConnection) {
    const uptimeMs = Date.now() - lastSuccessfulConnection.getTime();
    logger.info(`   - Última conexão bem-sucedida: ${Math.floor(uptimeMs / 1000)}s atrás`);
  }
}

// Função auxiliar para resetar o estado de reconexão
function resetReconnectState(): void {
  reconnectAttempts = 0;
  isConnecting = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// Função auxiliar para agendar reconexão
async function scheduleReconnect(reason: string, statusCode?: number): Promise<void> {
  // Prevenir múltiplas tentativas simultâneas
  if (isConnecting) {
    logger.info('⏳ Reconexão já em andamento, aguardando...');
    return;
  }

  // Limpar timer anterior se existir
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  const isError503 = statusCode === 503;
  const maxRetries = getMaxRetries(isError503);

  // Verificar se atingiu o limite de tentativas
  if (reconnectAttempts >= maxRetries) {
    logger.error(`❌ Máximo de tentativas de reconexão atingido (${maxRetries})`);
    logger.error('⚠️  Reinicie o aplicativo manualmente ou verifique a conexão');
    logErrorStats(statusCode);
    return;
  }

  isConnecting = true;
  reconnectAttempts++;
  connectionStats.lastError = { statusCode, reason, timestamp: new Date() };
  logErrorStats(statusCode);

  const delay = getReconnectDelay(isError503);
  logger.info(`🔄 Tentativa de reconexão ${reconnectAttempts}/${maxRetries}`);
  logger.info(`📊 Status Code: ${statusCode || 'N/A'} | Razão: ${reason}`);
  logger.info(`⏱️  Aguardando ${delay}ms (${(delay / 1000).toFixed(1)}s) antes de reconectar...`);

  reconnectTimer = setTimeout(async () => {
    try {
      logger.info('🔌 Iniciando tentativa de reconexão...');
      await connectToWhatsApp();
    } catch (error) {
      logger.error('❌ Erro na tentativa de reconexão:', error);
      isConnecting = false;
      // Tentar novamente se não atingiu o limite
      if (reconnectAttempts < maxRetries) {
        await scheduleReconnect('Erro na tentativa anterior', statusCode);
      } else {
        logger.error('🛑 Todas as tentativas de reconexão falharam');
        logErrorStats(statusCode);
      }
    }
  }, delay);
}

export async function connectToWhatsApp(): Promise<WhatsappSocket> {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(WHATSAPP_CONFIG.authStatePath);
    const { version, isLatest } = await baileys.fetchLatestWaWebVersion({});

    const sock: WhatsappSocket = makeWASocket({
      logger: P({ level: WHATSAPP_CONFIG.loggerLevel }),
      auth: state,
      version: version,//[2, 3000, 1027934701],
      printQRInTerminal: false,
      connectTimeoutMs: 60000,
      browser: WHATSAPP_CONFIG.browser,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      emitOwnEvents: false,
      getMessage: async (key) => {
        return { conversation: '' };
      },
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      // Conexão estabelecida com sucesso
      if (connection === 'open') {
        lastSuccessfulConnection = new Date();
        logger.success('✅ Conectado ao WhatsApp com sucesso!');
        logger.success(`🕐 Hora da conexão: ${lastSuccessfulConnection.toLocaleString('pt-BR')}`);
        resetReconnectState();
        return;
      }

      // Conexão fechada - tratar reconexão
      if (connection === 'close') {
        const error = lastDisconnect?.error as any;
        const statusCode = error?.output?.statusCode;
        const errorData = error?.data;

        logger.error(`🔴 Conexão fechada - Status: ${statusCode || 'N/A'}`);
        if (errorData) {
          logger.error(`📍 Dados do erro:`, errorData);
        }

        // Erro 401 - Logout (não reconectar)
        if (statusCode === 401) {
          logger.error('❌ Erro 401: Sessão expirada ou logout detectado');
          logger.error('🔑 Escaneie o QR Code novamente para autenticar');
          resetReconnectState();
          return;
        }

        // Erro 405 - Limpar sessão e reconectar
        if (statusCode === 405) {
          logger.info('🔧 Erro 405 detectado - limpando sessão...');
          await clearAuthState();
          reconnectAttempts = 0; // Resetar tentativas para este caso específico
          setTimeout(() => {
            isConnecting = false;
            connectToWhatsApp();
          }, 3000);
          return;
        }

        // Erro 503 - Service Unavailable (servidor temporariamente indisponível)
        if (statusCode === 503) {
          logger.warn('⚠️  Erro 503: Servidor WhatsApp temporariamente indisponível');
          await scheduleReconnect('Service Unavailable (503)', statusCode);
          return;
        }

        // Erro 500 - Internal Server Error
        if (statusCode === 500) {
          logger.warn('⚠️  Erro 500: Erro interno do servidor WhatsApp');
          await scheduleReconnect('Internal Server Error (500)', statusCode);
          return;
        }

        // Erro de timeout
        if (error?.message?.includes('timeout') || error?.message?.includes('Timeout')) {
          connectionStats.errorTimeoutCount++;
          logger.warn('⚠️  Timeout na conexão detectado');
          await scheduleReconnect('Connection Timeout', statusCode);
          return;
        }

        // Outros erros - tentar reconectar
        const shouldReconnect = statusCode !== 401;
        if (shouldReconnect) {
          logger.warn(`⚠️  Erro ${statusCode || 'desconhecido'} detectado`);
          await scheduleReconnect(`Erro ${statusCode || 'desconhecido'}`, statusCode);
        }
      }

      // Continuar com o handler original para QR Code e outros eventos
      handleConnectionUpdate({
        update,
        reconnectCallback: () => connectToWhatsApp()
      });
    });

    sock.ev.on('creds.update', saveCreds);

    // Log para confirmar que o handler foi registrado
    logger.info('📱 Handler de mensagens registrado com sucesso');

    sock.ev.on('messages.upsert', async (messages) => {
      try {
        logger.info(`🔔 Evento messages.upsert recebido! Total de mensagens: ${messages.messages?.length || 0}`);
        await handleMessagesUpsert({ sock, ...messages });
      } catch (error) {
        logger.error('❌ Erro ao processar mensagem:', error);
      }
    });

    isConnecting = false;
    return sock;
  } catch (error) {
    logger.error('❌ Erro ao conectar:', error);
    isConnecting = false;

    // Tentar reconectar em caso de erro
    const maxRetries = getMaxRetries(false);
    if (reconnectAttempts < maxRetries) {
      await scheduleReconnect('Erro na inicialização');
    }

    throw error;
  }
}

// Função para limpar o estado de autenticação
async function clearAuthState() {
  const fs = require('fs').promises;
  const path = require('path');

  try {
    const authPath = WHATSAPP_CONFIG.authStatePath;
    const files = await fs.readdir(authPath);

    for (const file of files) {
      await fs.unlink(path.join(authPath, file));
    }

    logger.info('Estado de autenticação limpo com sucesso');
  } catch (error) {
    logger.error('Erro ao limpar estado:', error);
  }
}

// Função para obter estatísticas de conexão
export function getConnectionStats() {
  return {
    ...connectionStats,
    lastSuccessfulConnection: lastSuccessfulConnection?.toISOString() || null,
    currentReconnectAttempts: reconnectAttempts,
    isConnecting,
    uptime: lastSuccessfulConnection
      ? Math.floor((Date.now() - lastSuccessfulConnection.getTime()) / 1000)
      : 0,
  };
}

// Função para resetar estatísticas (útil para testes ou manutenção)
export function resetConnectionStats() {
  connectionStats.totalReconnects = 0;
  connectionStats.error503Count = 0;
  connectionStats.error500Count = 0;
  connectionStats.errorTimeoutCount = 0;
  connectionStats.lastError = null;
  logger.info('📊 Estatísticas de conexão resetadas');
}

// Função para verificar saúde da conexão
export function getConnectionHealth() {
  const stats = getConnectionStats();
  const isHealthy = stats.currentReconnectAttempts === 0 && !stats.isConnecting;
  const errorRate = stats.totalReconnects > 0
    ? ((stats.error503Count + stats.error500Count + stats.errorTimeoutCount) / stats.totalReconnects) * 100
    : 0;

  return {
    isHealthy,
    status: isHealthy ? 'connected' : stats.isConnecting ? 'reconnecting' : 'disconnected',
    errorRate: errorRate.toFixed(2) + '%',
    uptime: stats.uptime,
    lastConnection: stats.lastSuccessfulConnection,
    stats,
  };
}
