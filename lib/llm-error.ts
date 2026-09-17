export function extractLlmErrorMessage(body: string) {
  const text = body.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as {
      error?: string | { message?: string; code?: string };
      message?: string;
      detail?: string;
    };
    const nested = parsed.error;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
    if (nested && typeof nested === 'object') {
      const message = [nested.message, nested.code].filter((item) => typeof item === 'string' && item.trim()).join(' · ');
      if (message) return message;
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim();
    if (typeof parsed.detail === 'string' && parsed.detail.trim()) return parsed.detail.trim();
  } catch {
    /* plain text body */
  }
  return text;
}

export function formatLlmHttpError(status: number, body: string) {
  const detail = extractLlmErrorMessage(body).slice(0, 160);
  if (detail) return `AI 返回 ${status}：${detail}，请稍后再试。`;
  return `AI 返回 ${status} 错误，请稍后再试。`;
}

export function formatLlmCallError(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError') return 'AI 调用超时，请稍后再试。';
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (message) return `AI 调用失败：${message}，请稍后再试。`;
  return 'AI 调用失败，请稍后再试。';
}

export function publicVerdictError(error: string) {
  const line = error.replace(/\s+/g, ' ').trim();
  return line.slice(0, 300) || 'AI 概览暂时无法生成，请稍后再试。';
}
