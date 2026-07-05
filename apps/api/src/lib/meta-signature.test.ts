import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyMetaSignature } from './meta-signature';

const SECRET = 'test-app-secret';
const sign = (body: string): string =>
  `sha256=${createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')}`;

describe('verifyMetaSignature', () => {
  it('accepts a valid signature', () => {
    const body = '{"object":"whatsapp_business_account"}';
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyMetaSignature('{"tampered":true}', sign('{"original":true}'), SECRET)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const body = '{"a":1}';
    const wrong = `sha256=${createHmac('sha256', 'other').update(body).digest('hex')}`;
    expect(verifyMetaSignature(body, wrong, SECRET)).toBe(false);
  });

  it('rejects missing or malformed headers', () => {
    expect(verifyMetaSignature('{}', undefined, SECRET)).toBe(false);
    expect(verifyMetaSignature('{}', 'md5=abc', SECRET)).toBe(false);
    expect(verifyMetaSignature('{}', 'sha256=short', SECRET)).toBe(false);
  });
});
