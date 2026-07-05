export type ContextWindowMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
};

export type ContextWindowOptions = {
  maxMessages: number;
  maxTotalChars: number;
};

export type ContextWindowResult<T extends ContextWindowMessage> = {
  messages: T[];
  truncated: boolean;
  droppedCount: number;
};

const CONTEXT_TRUNCATION_MARKER = '\n[...context truncated]';

const contentLength = (message: ContextWindowMessage): number => message.content?.length ?? 0;

const totalLength = (messages: ContextWindowMessage[]): number =>
  messages.reduce((acc, message) => acc + contentLength(message), 0);

const truncateMessageContent = <T extends ContextWindowMessage>(message: T, budget: number): T => {
  if (message.content === null || message.content.length <= budget) return message;
  const sliceLength = Math.max(0, budget - CONTEXT_TRUNCATION_MARKER.length);
  return {
    ...message,
    content: `${message.content.slice(0, sliceLength)}${CONTEXT_TRUNCATION_MARKER}`,
  };
};

export const truncateToContextWindow = <T extends ContextWindowMessage>(
  messages: T[],
  options: ContextWindowOptions,
): ContextWindowResult<T> => {
  if (messages.length === 0) return { messages, truncated: false, droppedCount: 0 };

  const hasSystem = messages[0]?.role === 'system';
  const system = hasSystem ? messages[0] : null;
  const rest = hasSystem ? messages.slice(1) : messages;
  const maxRecent = Math.max(1, options.maxMessages);
  const recent = rest.length > maxRecent ? rest.slice(-maxRecent) : rest;
  let droppedCount = rest.length - recent.length;
  const byRecency = system ? [system, ...recent] : recent;

  if (totalLength(byRecency) <= options.maxTotalChars) {
    return {
      messages: byRecency,
      truncated: droppedCount > 0,
      droppedCount,
    };
  }

  const output: T[] = [];
  let remaining = options.maxTotalChars;
  if (system) {
    const safeSystem = truncateMessageContent(system, remaining);
    output.push(safeSystem);
    remaining -= contentLength(safeSystem);
  }

  const tail = recent.at(-1);
  if (!tail || remaining <= 0) {
    droppedCount += recent.length;
    return { messages: output, truncated: true, droppedCount };
  }

  const safeTail = truncateMessageContent(tail, remaining);
  remaining -= contentLength(safeTail);

  const keptMiddle: T[] = [];
  const middle = recent.slice(0, -1);
  for (let index = middle.length - 1; index >= 0; index--) {
    const message = middle[index];
    const length = contentLength(message);
    if (length > remaining) {
      droppedCount++;
      continue;
    }
    keptMiddle.unshift(message);
    remaining -= length;
  }

  return {
    messages: [...output, ...keptMiddle, safeTail],
    truncated: true,
    droppedCount,
  };
};
