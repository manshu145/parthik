import { getServerEnv } from '@/lib/config/env';
import { ConfigurationError } from '@/lib/errors';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function key() {
  const secret = getServerEnv().AUTH_SECRET;
  if (!secret) throw new ConfigurationError('AUTH_SECRET is required to protect provider credentials.');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), encoder.encode(value));
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(value: string): Promise<string> {
  const [version, iv, payload] = value.split('.');
  if (version !== 'v1' || !iv || !payload) throw new ConfigurationError('Stored credential is invalid.');
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await key(), fromBase64(payload));
  return decoder.decode(clear);
}

function toBase64(value: Uint8Array) { return Buffer.from(value).toString('base64url'); }
function fromBase64(value: string) { return new Uint8Array(Buffer.from(value, 'base64url')); }
