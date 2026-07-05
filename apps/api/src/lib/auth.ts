import bcrypt from 'bcrypt';
import jwt, { type SignOptions } from 'jsonwebtoken';

const SALT_ROUNDS = 12;

export type TokenPayload = {
  userId: string;
  role: string;
};

const getSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  return secret;
};

export const hashPassword = async (password: string): Promise<string> =>
  bcrypt.hash(password, SALT_ROUNDS);

export const verifyPassword = async (password: string, hash: string): Promise<boolean> =>
  bcrypt.compare(password, hash);

export const createToken = (
  payload: TokenPayload,
  expiresIn: SignOptions['expiresIn'] = (process.env.SESSION_EXPIRY_HOURS
    ? `${process.env.SESSION_EXPIRY_HOURS}h`
    : '24h') as SignOptions['expiresIn'],
): string => jwt.sign(payload, getSecret(), { expiresIn });

export const verifyToken = (token: string): (TokenPayload & { exp: number }) | null => {
  try {
    return jwt.verify(token, getSecret()) as TokenPayload & { exp: number };
  } catch {
    return null;
  }
};
