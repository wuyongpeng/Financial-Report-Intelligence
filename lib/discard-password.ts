/**
 * Ops soft-delete gate until real auth exists.
 * Exact match, case-sensitive. Do not log submitted values.
 */
export const DISCARD_CONFIRM_PASSWORD = 'EVA';

export function matchesDiscardPassword(value: unknown): boolean {
  return typeof value === 'string' && value === DISCARD_CONFIRM_PASSWORD;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Hide the discard password in acceptance-case copy without touching the real gate. */
export function redactDiscardPasswordCopy(value: string): string {
  const secret = DISCARD_CONFIRM_PASSWORD;
  if (!value || !value.includes(secret)) return value;
  return value
    .replaceAll(`删除密码是 ${secret}`, '删除时需输入正确密码')
    .replaceAll(`再输入 ${secret}`, '再输入正确密码')
    .replaceAll(`${secret} 才能删`, '输入正确密码才能删')
    .replaceAll(`输入 ${secret} 确认`, '输入正确密码确认')
    .replace(new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(secret)}(?![A-Za-z0-9])`, 'g'), '正确密码');
}
