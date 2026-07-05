type LogMeta = Record<string, unknown>;
type LogInput = LogMeta | string;

const normalize = (metaOrMessage?: LogInput, message?: string): { meta: LogMeta; message?: string } => {
  if (typeof metaOrMessage === 'string') return { meta: {}, message: metaOrMessage };
  return { meta: metaOrMessage ?? {}, message };
};

const write = (level: 'info' | 'warn' | 'error', metaOrMessage?: LogInput, message?: string): void => {
  const entry = normalize(metaOrMessage, message);
  const payload = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg: entry.message,
    ...entry.meta,
  });

  if (level === 'error') {
    console.error(payload);
    return;
  }
  console.log(payload);
};

export const logger = {
  info: (metaOrMessage?: LogInput, message?: string): void => write('info', metaOrMessage, message),
  warn: (metaOrMessage?: LogInput, message?: string): void => write('warn', metaOrMessage, message),
  error: (metaOrMessage?: LogInput, message?: string): void => write('error', metaOrMessage, message),
};
