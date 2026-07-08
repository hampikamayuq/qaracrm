export type DebounceFlush = { conversationId: string; messageId: string; text: string };
export type DebounceResult = { status: 'process' | 'skip' | 'optout' | 'defer' };
export type DebounceFlushHandler = (flush: DebounceFlush) => void | Promise<void>;

export type Debouncer = {
  check(
    conversationId: string,
    messageId: string,
    text?: string,
    onFlush?: DebounceFlushHandler,
  ): DebounceResult;
  isOptOut(text: string): boolean;
};

const DEFAULT_WINDOW_MS = Number.parseInt(process.env.TAWANY_DEBOUNCE_MS ?? '20000', 10);
const OPTOUT_PATTERN = /(^|\s)(parar|pare|sair|cancelar|descadastrar|stop|nao quero|não quero)([\s.!?]|$)/i;

export const createDebounce = (windowMs = DEFAULT_WINDOW_MS): Debouncer => {
  const timers = new Map<string, {
    timer: ReturnType<typeof setTimeout>;
    messageId: string;
    text: string;
    onFlush?: DebounceFlushHandler;
  }>();
  const resetTimer = (
    conversationId: string,
    messageId: string,
    text: string,
    onFlush?: DebounceFlushHandler,
  ): void => {
    timers.set(conversationId, {
      messageId,
      text,
      onFlush,
      timer: setTimeout(() => {
        const pending = timers.get(conversationId);
        timers.delete(conversationId);
        if (pending?.onFlush) {
          void pending.onFlush({ conversationId, messageId: pending.messageId, text: pending.text });
        }
      }, windowMs),
    });
  };

  return {
    check(
      conversationId: string,
      messageId: string,
      text = '',
      onFlush?: DebounceFlushHandler,
    ): DebounceResult {
      if (this.isOptOut(text)) {
        const existing = timers.get(conversationId);
        if (existing) clearTimeout(existing.timer);
        timers.delete(conversationId);
        return { status: 'optout' };
      }

      const existing = timers.get(conversationId);
      if (existing) {
        clearTimeout(existing.timer);
        resetTimer(conversationId, messageId, text, onFlush);
        return onFlush ? { status: 'defer' } : { status: 'skip' };
      }

      resetTimer(conversationId, messageId, text, onFlush);
      return onFlush ? { status: 'defer' } : { status: 'process' };
    },

    isOptOut(text: string): boolean {
      return OPTOUT_PATTERN.test(text.trim());
    },
  };
};

export const defaultDebounce = createDebounce();
