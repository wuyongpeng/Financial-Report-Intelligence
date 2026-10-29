import { ApiError, requiredText } from './api';

export type FeedbackInput = {
  message: string;
  page: string | null;
  url: string | null;
  userAgent: string | null;
};

/** Validate public feedback payload before touching the database. */
export function parseFeedbackInput(
  body: Record<string, unknown>,
  fallbackUserAgent?: string | null,
): FeedbackInput {
  const message = requiredText(body.message, '反馈内容', 4000);
  const page = typeof body.page === 'string' ? body.page.trim().slice(0, 200) || null : null;
  const url = typeof body.url === 'string' ? body.url.trim().slice(0, 500) || null : null;
  const fromBody = typeof body.userAgent === 'string' ? body.userAgent.trim().slice(0, 500) : '';
  const fromHeader = (fallbackUserAgent ?? '').trim().slice(0, 500);
  const userAgent = fromBody || fromHeader || null;
  return { message, page, url, userAgent };
}

export function assertFeedbackBodyObject(body: unknown): asserts body is Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, '请求必须为 JSON 对象');
  }
}
