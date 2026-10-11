import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function passwordMatches(candidate, configuredPassword) {
  const candidateHash = createHash('sha256').update(candidate).digest();
  const configuredHash = createHash('sha256').update(configuredPassword).digest();
  return timingSafeEqual(candidateHash, configuredHash);
}

export function createSessionToken(sessionSecret, expiresAt) {
  const value = String(expiresAt);
  const signature = createHmac('sha256', sessionSecret).update(`admin:${value}`).digest('hex');
  return `${value}.${signature}`;
}

export function verifySessionToken(token, sessionSecret, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const [expiry, signature, extra] = token.split('.');
  if (!expiry || !signature || extra !== undefined || !/^\d+$/.test(expiry) || !/^[a-f\d]{64}$/i.test(signature)) {
    return false;
  }
  const expiresAt = Number(expiry);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;

  const expected = createHmac('sha256', sessionSecret).update(`admin:${expiry}`).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
