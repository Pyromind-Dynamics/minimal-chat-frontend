import { AUTH_COOKIE_NAME, TEST_JWT_SECRET } from './config';

const encoder = new TextEncoder();

function base64UrlEncode(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function signHs256(input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(TEST_JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(input));
  return base64UrlEncode(signature);
}

export async function createTestAuthToken(userId: string): Promise<string> {
  const numericUserId = Number(userId);
  const safeUserId = Number.isFinite(numericUserId) ? numericUserId : userId;
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };
  const payload = {
    sub: `debug-user-${userId}`,
    email: `debug-user-${userId}@example.test`,
    user_id: safeUserId,
    group_id: 0,
    full_phone_num: '',
    iat: now,
    exp: now + 60 * 60 * 24,
  };

  const signingInput = [
    base64UrlEncode(JSON.stringify(header)),
    base64UrlEncode(JSON.stringify(payload)),
  ].join('.');
  return `${signingInput}.${await signHs256(signingInput)}`;
}

export async function setTestAuthCookie(userId: string): Promise<void> {
  const token = await createTestAuthToken(userId);
  document.cookie = `${AUTH_COOKIE_NAME}=${token}; path=/; SameSite=Lax`;
}
