/**
 * Secret detection. Errs on the side of flagging: a false positive only moves a value
 * into .env; a false negative leaks a credential into a git-tracked registry.
 */

const SECRET_KEY =
  /(api[_-]?key|apikey|token|secret|password|passwd|pwd|auth|bearer|cookie|credential|cred|session|private|hash|signature|sid\b|pat\b)/i;

/** Values that are references, not literals: ${VAR}, $VAR. */
export const ENV_REF = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/;
const HAS_REF = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/** Long, high-variety token without spaces/paths/URLs — looks like a credential regardless of key. */
export function looksLikeToken(value: string): boolean {
  if (value.length < 32) return false;
  if (/\s/.test(value) || value.includes('://') || value.startsWith('/') || value.startsWith('{') || value.startsWith('[')) return false;
  if (/^[0-9]+$/.test(value)) return false;
  // npm/pypi package specs: @scope/name@1.2.3, name@latest
  if (/[@/]/.test(value) && /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+(@[\w.^~<>=*-]+)?$/i.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[-_+=/.]/].filter((r) => r.test(value)).length;
  return classes >= 3;
}

/** A literal secret value (not an env reference) under a secret-looking key, or a token-looking value. */
export function isInlineSecret(key: string, value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (ENV_REF.test(value) || HAS_REF.test(value)) return false;
  // booleans / short flags under secret-ish keys (e.g. SSL_VERIFY=false) are not secrets
  if (/^(true|false|0|1|yes|no)$/i.test(value)) return false;
  if (/^https?:\/\//.test(value) && !/[?&][^=]*(key|token|secret)/i.test(value)) return false;
  return isSecretKey(key) || looksLikeToken(value);
}

/** Mask a value for display. */
export function mask(value: string): string {
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 3)}…${'•'.repeat(4)}(${value.length})`;
}
