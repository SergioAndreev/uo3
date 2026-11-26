/** Канонизация и проверка email (длины по RFC 5321). */
export function canonicalEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || [...email].some((c) => c <= ' ' || c === '\u007f')) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at !== email.indexOf('@')) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return null;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  const labels = domain.split('.');
  if (labels.length < 2) return null;
  const label = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
  if (!labels.every((l) => label.test(l))) return null;
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1] ?? '')) return null;
  return email;
}

export const domainOf = (email: string): string => email.slice(email.lastIndexOf('@') + 1);
