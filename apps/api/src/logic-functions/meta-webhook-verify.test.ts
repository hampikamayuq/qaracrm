import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleMetaVerify } from './meta-webhook-verify';

describe('handleMetaVerify', () => {
  beforeEach(() => {
    process.env.META_VERIFY_TOKEN = 'verify-me';
  });
  afterEach(() => {
    delete process.env.META_VERIFY_TOKEN;
  });

  const q = (over: Record<string, string | undefined>) => ({
    queryStringParameters: {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'verify-me',
      'hub.challenge': '12345',
      ...over,
    },
  });

  it('echoes hub.challenge on a valid handshake', () => {
    const res = handleMetaVerify(q({}));
    expect(res.status).toBe(200);
    expect(res.body).toBe('12345');
  });

  it('403s on wrong token, wrong mode, or unconfigured server', () => {
    expect(handleMetaVerify(q({ 'hub.verify_token': 'nope' })).status).toBe(403);
    expect(handleMetaVerify(q({ 'hub.mode': 'unsubscribe' })).status).toBe(403);
    delete process.env.META_VERIFY_TOKEN;
    expect(handleMetaVerify(q({})).status).toBe(403);
  });
});
