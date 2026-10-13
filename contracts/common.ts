import { ApiError } from '@/lib/api';

export type ApiErrorBody = { error: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function contractObject(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} 响应格式错误`);
  return value;
}

export function contractArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} 响应格式错误`);
  return value;
}

export function contractString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} 响应格式错误`);
  return value;
}

export function contractNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} 响应格式错误`);
  return value;
}

export function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return contractString(value, name);
}

export function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new ApiError(400, `${name} 必须为布尔值`);
  return value;
}

/** Read and validate a successful JSON response at a Web/Mobile client boundary. */
export async function readContractJson<T>(response: Response, parse: (value: unknown) => T): Promise<T> {
  const payload = await response.json().catch(() => {
    throw new Error(`接口返回的不是有效 JSON（HTTP ${response.status}）`);
  });
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  return parse(payload);
}
