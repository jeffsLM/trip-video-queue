export const WHATSAPP_CONFIG = {
  authStatePath: 'auth',
  loggerLevel: 'silent' as const,
  browser: ['WhatsApp Bot', 'Chrome', '1.0.0'] as [string, string, string],
  targetJid: '5519987428185@s.whatsapp.net',
  initialMessage: 'Olá! Mensagem enviada pelo bot do Baileys.',

  // Configuração de reconexão e resiliência
  reconnect: {
    maxRetries: 10,
    initialDelay: 3000,
    maxDelay: 60000,
    backoffMultiplier: 2,
    // Configuração específica para erro 503
    error503: {
      maxRetries: 15,
      initialDelay: 5000,
    },
  },

  // Configuração de timeout
  connection: {
    timeoutMs: 60000,
    keepAliveIntervalMs: 30000,
  },
};
