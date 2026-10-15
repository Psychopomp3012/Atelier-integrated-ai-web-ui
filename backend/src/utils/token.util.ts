import { createHmac, timingSafeEqual } from 'node:crypto';

export interface JwtPayload {
  sub: string;
  email?: string;
  name?: string;
  iat: number;
  exp: number;
}

export interface TokenGenerator {
  generateSessionToken(payload?: { userId: string; email?: string; name?: string }): string;
  generateJwt(payload: { userId: string; email?: string; name?: string }, expiresInDays?: number): string;
  verifyJwt(token: string): { valid: boolean; payload?: JwtPayload; error?: string };
  generateStateToken(): string;
  isTokenValid(token: string): boolean;
}

const JWT_SECRET = process.env.JWT_SECRET || 'harness-ai-agent-workspace-secret-key-2026';

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export const tokenUtil: TokenGenerator = {
  generateJwt(payload: { userId: string; email?: string; name?: string }, expiresInDays = 7): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiresInDays * 24 * 60 * 60; // 7 days (1 week)

    const fullPayload: JwtPayload = {
      sub: payload.userId,
      email: payload.email,
      name: payload.name,
      iat: now,
      exp,
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    const signature = createHmac('sha256', JWT_SECRET)
      .update(dataToSign)
      .digest('base64url');

    return `${dataToSign}.${signature}`;
  },

  generateSessionToken(payload?: { userId: string; email?: string; name?: string }): string {
    return this.generateJwt({
      userId: payload?.userId || `usr_${Date.now()}`,
      email: payload?.email,
      name: payload?.name,
    }, 7);
  },

  verifyJwt(token: string): { valid: boolean; payload?: JwtPayload; error?: string } {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Empty token' };
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      // Legacy session format fallback
      if (token.startsWith('harness_sess_') && token.length > 20) {
        return {
          valid: true,
          payload: {
            sub: 'legacy_user',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 7 * 86400,
          },
        };
      }
      return { valid: false, error: 'Malformed token structure' };
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = createHmac('sha256', JWT_SECRET)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    try {
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expectedSignature);
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        return { valid: false, error: 'Invalid token signature' };
      }

      const payloadStr = base64UrlDecode(encodedPayload);
      const payload = JSON.parse(payloadStr) as JwtPayload;

      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return { valid: false, error: 'Token has expired' };
      }

      return { valid: true, payload };
    } catch {
      return { valid: false, error: 'Failed to parse token payload' };
    }
  },

  generateStateToken(): string {
    return `oauth_st_${Buffer.from(Math.random().toString()).toString('hex')}`;
  },

  isTokenValid(token: string): boolean {
    return this.verifyJwt(token).valid;
  },
};
