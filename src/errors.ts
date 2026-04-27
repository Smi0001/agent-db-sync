export const ALREADY_APPLIED_CODES = new Set([
  '42P07',
  '42701',
  '42710',
  '42P06',
  '42723',
  '42P03',
]);

export const ALREADY_REVERTED_CODES = new Set([
  '42P01',
  '42703',
  '42704',
]);

interface MaybePgError {
  code?: string;
  message?: string;
  detail?: string;
  hint?: string;
}

export function isAlreadyApplied(err: unknown): boolean {
  const e = err as MaybePgError;
  return !!e?.code && ALREADY_APPLIED_CODES.has(e.code);
}

export function isAlreadyReverted(err: unknown): boolean {
  const e = err as MaybePgError;
  return !!e?.code && ALREADY_REVERTED_CODES.has(e.code);
}

export function describePgError(err: unknown): string {
  const e = err as MaybePgError;
  if (!e) return 'Unknown error';
  const parts: string[] = [];
  if (e.code) parts.push(`[${e.code}]`);
  if (e.message) parts.push(e.message);
  if (e.detail) parts.push(`detail: ${e.detail}`);
  if (e.hint) parts.push(`hint: ${e.hint}`);
  return parts.join(' ');
}
