import { EventEmitter } from 'node:events';

// ponytail: emitter em memória, single-instance (Render roda 1 instância);
// se escalar horizontal, trocar por Redis pub/sub.

export type InboundMessageEvent = {
  conversationId: string;
  leadName?: string;
  preview: string;
};

const INBOUND_MESSAGE = 'inbound-message';
const PREVIEW_MAX_CHARS = 80;

const emitter = new EventEmitter();
// Cada aba do CRM conectada ao SSE é um listener — sem teto artificial.
emitter.setMaxListeners(0);

// Emissão protegida: um listener que lança nunca quebra o processamento do
// webhook que emitiu (só loga).
export const emitInboundMessage = (event: InboundMessageEvent): void => {
  try {
    emitter.emit(INBOUND_MESSAGE, { ...event, preview: event.preview.slice(0, PREVIEW_MAX_CHARS) });
  } catch (err) {
    console.error('[events] emitInboundMessage failed (non-fatal):', (err as Error).message);
  }
};

export const subscribe = (listener: (event: InboundMessageEvent) => void): (() => void) => {
  emitter.on(INBOUND_MESSAGE, listener);
  return () => {
    emitter.off(INBOUND_MESSAGE, listener);
  };
};
