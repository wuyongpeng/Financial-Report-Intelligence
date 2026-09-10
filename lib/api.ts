export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function apiError(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status, headers: { 'cache-control': 'no-store' } });
  console.error('[api] request failed', { message: error instanceof Error ? error.message : 'Unknown error' });
  return Response.json({ error: '服务暂时不可用，请稍后重试。' }, { status: 503, headers: { 'cache-control': 'no-store' } });
}

export async function readObject(request: Request) {
  const text = await request.text();
  if (text.length > 20_000) throw new ApiError(413, '请求内容过长');
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new ApiError(400, '请求必须为 JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, '请求必须为 JSON 对象');
  return body as Record<string, unknown>;
}

export function requiredText(value: unknown, name: string, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(400, `${name} 必须是 1–${max} 字符的文本`);
  return value.trim();
}

export function uuid(value: unknown, name: string) {
  const text = requiredText(value, name, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new ApiError(400, `${name} 格式错误`);
  return text;
}
