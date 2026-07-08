import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, createToken, verifyToken } from './auth';

describe('auth utilities', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('mysecret');
    expect(hash).not.toBe('mysecret');
    expect(await verifyPassword('mysecret', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('creates and verifies a JWT token', () => {
    process.env.JWT_SECRET = 'test-secret';
    const token = createToken({ userId: 'u1', role: 'admin' });
    expect(typeof token).toBe('string');

    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    if (!payload) throw new Error('expected token payload');
    expect(payload.userId).toBe('u1');
    expect(payload.role).toBe('admin');
    expect(payload.exp).toBeDefined();
  });

  it('verifies token returns null for invalid token', () => {
    process.env.JWT_SECRET = 'test-secret';
    expect(verifyToken('bad-token')).toBeNull();
  });

  it('verifies token returns null for expired token', () => {
    process.env.JWT_SECRET = 'test-secret';
    const token = createToken({ userId: 'u1', role: 'admin' }, '-1h');
    expect(verifyToken(token)).toBeNull();
  });
});
