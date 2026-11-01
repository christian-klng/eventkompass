// Passwörter, Session-Tokens, Cookies und eine einfache Bremse gegen Durchprobieren.
// Bewusst nur mit node:crypto – keine zusätzlichen Pakete.

import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export const SESSION_COOKIE = 'ek_session';
export const SESSION_DAYS = 30;
export const MIN_PASSWORD = 10;

// Format: scrypt$<salt hex>$<hash hex>
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(pw, stored) {
  const [algo, saltHex, hashHex] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(String(pw), Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');

export function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Secure nur über HTTPS – auf der HTTP-Domain würde der Browser das Cookie sonst verwerfen.
export function setSessionCookie(req, res, token) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
export function clearSessionCookie(req, res) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

// Zählt Versuche je Schlüssel in einem Zeitfenster (im Speicher, reicht für einen Container).
export function createLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    blocked(key) {
      const h = hits.get(key);
      if (h && h.resetAt < Date.now()) hits.delete(key);
      return (hits.get(key)?.count || 0) >= max;
    },
    hit(key) {
      const h = hits.get(key);
      if (!h || h.resetAt < Date.now()) hits.set(key, { count: 1, resetAt: Date.now() + windowMs });
      else h.count++;
    },
    reset(key) { hits.delete(key); },
  };
}
