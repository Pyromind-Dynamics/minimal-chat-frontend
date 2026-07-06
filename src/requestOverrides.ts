const CUSTOM_COOKIE_NAMES_STORAGE_KEY = 'minimal-chat.customCookieNames';

export interface RequestOverrides {
  cookie?: string;
  xCluster?: string;
}

interface CookiePair {
  name: string;
  value: string;
}

export function normalizeRequestValue(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function parseCookieHeader(cookieHeader?: string): CookiePair[] {
  const pairs = new Map<string, string>();
  for (const part of cookieHeader?.split(';') ?? []) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (name) {
      pairs.set(name, value);
    }
  }
  return [...pairs].map(([name, value]) => ({ name, value }));
}

function getRememberedCookieNames(): string[] {
  try {
    const saved = localStorage.getItem(CUSTOM_COOKIE_NAMES_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function rememberCookieNames(cookieNames: string[]): void {
  localStorage.setItem(CUSTOM_COOKIE_NAMES_STORAGE_KEY, JSON.stringify(cookieNames));
}

function clearCookie(name: string): void {
  document.cookie = `${name}=; path=/; Max-Age=0; SameSite=Lax`;
}

function setCookie({ name, value }: CookiePair): void {
  document.cookie = `${name}=${value}; path=/; SameSite=Lax`;
}

export function applyRequestCookies(cookieHeader?: string): void {
  const customCookies = parseCookieHeader(cookieHeader);
  const nextNames = new Set(customCookies.map((cookie) => cookie.name));

  for (const name of getRememberedCookieNames()) {
    if (!nextNames.has(name)) {
      clearCookie(name);
    }
  }

  for (const cookie of customCookies) {
    setCookie(cookie);
  }
  rememberCookieNames([...nextNames]);
}
