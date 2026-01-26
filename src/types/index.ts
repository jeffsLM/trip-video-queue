import type {
  AuthenticationState,
  MessageUpsertType,
  proto,
  AnyMessageContent,
  WAMessage,
  WASocket,
  WAConnectionState,
} from '@whiskeysockets/baileys';

export interface WhatsappMessage {
  key: {
    fromMe: boolean;
    remoteJid: string;
  };
  message?: proto.IMessage;
}

export type ConnectionUpdate = {
  qr?: string;
  connection?: WAConnectionState;
  lastDisconnect?: {
    error: any;
  };
};

export type MessagesUpsert = {
  messages: WAMessage[];
  type: MessageUpsertType;
  sock: WhatsappSocket;
};

export type AuthState = AuthenticationState;

export type WhatsappSocket = WASocket;

export type SendMessage = (jid: string, content: AnyMessageContent) => Promise<void>;
