# Trip Video Queue

Sistema de processamento de vídeos de viagens via WhatsApp com integração RabbitMQ.

## Descrição

Este projeto fornece uma infraestrutura completa para receber e processar mensagens do WhatsApp utilizando a biblioteca Baileys e filas RabbitMQ para processamento assíncrono.

### Recursos

- ✅ Conexão WhatsApp funcional com reconexão automática
- ✅ Sistema de filas RabbitMQ (publicar/consumir)
- ✅ Logger estruturado
- ✅ Handler genérico de mensagens pronto para extensão
- ✅ Filtro de grupos autorizados
- ✅ Sistema anti-duplicação de mensagens
- ✅ Configuração PM2 para produção
- ✅ TypeScript configurado

## Pré-requisitos

- Node.js 18+
- RabbitMQ instalado e rodando
- Yarn ou npm

## Instalação

```bash
# Instalar dependências
yarn install
```

## Configuração

Crie um arquivo `.env` na raiz do projeto baseado no `.env.example`:

```bash
# WhatsApp
TARGET_GROUP_ID=         # ID do grupo WhatsApp autorizado (ex: 123456789@g.us)

# RabbitMQ
RABBITMQ_URL=amqp://localhost:5672
TO_WHATSAPP_QUEUE=to-whatsapp
FROM_WHATSAPP_QUEUE=from-whatsapp

# Environment
NODE_ENV=development
```

### Como obter o TARGET_GROUP_ID

1. Execute o projeto em modo desenvolvimento
2. Envie uma mensagem em qualquer grupo
3. Verifique os logs para encontrar o `remoteJid` do grupo
4. Copie o ID e adicione ao `.env`

## Executar

### Desenvolvimento

```bash
# Modo watch (recarrega automaticamente)
yarn dev
```

### Produção

```bash
# Build
yarn build

# Start
yarn start

# Ou com PM2
pm2 start ecosystem.config.js
```

## Estrutura de Filas RabbitMQ

### TO_WHATSAPP

Mensagens nesta fila serão enviadas via WhatsApp para o grupo/contato configurado.

**Formato:** String de texto simples

**Exemplo:**
```
"Olá, esta é uma mensagem de teste!"
```

### FROM_WHATSAPP

Dados processados de mensagens recebidas do WhatsApp.

**Formato:** JSON

**Exemplo:**
```json
{
  "id": "unique-id",
  "type": "video",
  "data": {
    "videoUrl": "https://...",
    "caption": "Vídeo da viagem"
  },
  "timestamp": 1234567890,
  "user": "5519999999999@s.whatsapp.net"
}
```

## Estrutura do Projeto

```
src/
├── config/              # Configurações (WhatsApp, RabbitMQ)
├── services/            # Serviços principais (WhatsApp, RabbitMQ)
├── handlers/            # Handlers de eventos (mensagens, conexão)
├── types/               # Tipos TypeScript
├── utils/               # Utilitários (logger, helpers)
└── index.ts             # Entry point
```

## Desenvolvimento

### Adicionar Handler de Vídeos

Edite `src/handlers/message.handlers.ts` e implemente o processamento de vídeos:

```typescript
if (msg.message.videoMessage) {
  const video = msg.message.videoMessage;
  // Implementar download e processamento do vídeo
  // Publicar na fila FROM_WHATSAPP
}
```

### Publicar Mensagem via RabbitMQ

```typescript
import { publishToWhatsApp } from './services/rabbitMQ.service';

await publishToWhatsApp('Mensagem para enviar via WhatsApp');
```

### Consumir Dados Processados

```typescript
import { consumeFromWhatsApp } from './services/rabbitMQ.service';

await consumeFromWhatsApp(async (data) => {
  console.log('Dados recebidos:', data);
  // Processar dados
});
```

## Segurança

- ⚠️ **NÃO** commite o arquivo `.env`
- ⚠️ **NÃO** commite a pasta `auth/` (credenciais WhatsApp)
- ✅ Use variáveis de ambiente para dados sensíveis
- ✅ Valide o `TARGET_GROUP_ID` para evitar spam

## Logs

Os logs são estruturados por contexto:

- 🔵 INFO - Informações gerais
- 🟢 SUCCESS - Operações bem-sucedidas
- 🟡 WARN - Avisos
- 🔴 ERROR - Erros

Em produção (`NODE_ENV=production`), apenas logs de erro são exibidos.

## Reconexão Automática

O sistema possui reconexão automática com backoff exponencial:

- ✅ Erro 503: até 15 tentativas
- ✅ Outros erros: até 10 tentativas
- ✅ Delay inicial: 3s
- ✅ Delay máximo: 60s
- ✅ Multiplicador: 2x

## Troubleshooting

### WhatsApp não conecta

1. Verifique se o QR Code foi escaneado
2. Delete a pasta `auth/` e tente novamente
3. Verifique a conexão com a internet

### RabbitMQ não conecta

1. Verifique se o RabbitMQ está rodando: `sudo systemctl status rabbitmq-server`
2. Teste a URL: `amqp://localhost:5672`
3. Verifique credenciais se usar autenticação

### Mensagens não são processadas

1. Verifique o `TARGET_GROUP_ID` no `.env`
2. Confirme que as mensagens vêm do grupo correto
3. Verifique os logs para erros

## Licença

MIT
