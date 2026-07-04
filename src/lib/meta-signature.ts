import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

// Verifica X-Hub-Signature-256 (Meta) sobre o rawBody, em tempo constante.
export const verifyMetaSignature = (
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean => {
  if (!signatureHeader?.startsWith(PREFIX)) return false;
  const received = signatureHeader.slice(PREFIX.length);
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(expected, 'utf8'));
};
