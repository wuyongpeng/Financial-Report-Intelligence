/**
 * Ops soft-delete gate until real auth exists.
 * Exact match, case-sensitive. Do not log submitted values.
 */
export const DISCARD_CONFIRM_PASSWORD = 'EVA';

export function matchesDiscardPassword(value: unknown): boolean {
  return typeof value === 'string' && value === DISCARD_CONFIRM_PASSWORD;
}
