export type DebounceResult = { status: 'process' | 'skip' | 'optout' };

export type Debouncer = {
  check(conversationId: string, messageId: string, text?: string): DebounceResult;
  isOptOut(text: string): boolean;
};

const DEFAULT_WINDOW_MS = Number.parseInt(process.env.TAWANY_DEBOUNCE_MS ?? '20000', 10);
const OPTOUT_PATTERN = /(^|\s)(parar|pare|sair|cancelar|descadastrar|stop|nao quero|não quero)([\s.!?]|$)/i;

export const createDebounce = (windowMs = DEFAULT_WINDOW_MS): Debouncer => {
  const timers = new Map<string, { timer: ReturnType<typeof setTimeout>; messageId: string }>();
  const resetTimer = (conversationId: string, messageId: string): void => {
    timers.set(conversationId, {
      messageId,
      timer: setTimeout(() => timers.delete(conversationId), windowMs),
    });
  };

  return {
    check(conversationId: string, messageId: string, text = ''): DebounceResult {
      if (this.isOptOut(text)) {
        const existing = timers.get(conversationId);
        if (existing) clearTimeout(existing.timer);
        timers.delete(conversationId);
        return { status: 'optout' };
      }

      const existing = timers.get(conversationId);
      if (existing) {
        clearTimeout(existing.timer);
        resetTimer(conversationId, messageId);
        return { status: 'skip' };
      }

      resetTimer(conversationId, messageId);
      return { status: 'process' };
    },

    isOptOut(text: string): boolean {
      return OPTOUT_PATTERN.test(text.trim());
    },
  };
};

export const defaultDebounce = createDebounce();
