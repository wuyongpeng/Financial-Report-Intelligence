import { ApiError, requiredText } from './api';

export const FEEDBACK_CATEGORIES = ['体验问题', '功能建议', '数据不准', '其它'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export const DEFAULT_FEEDBACK_CATEGORY: FeedbackCategory = '其它';

export type FeedbackInput = {
  category: FeedbackCategory;
  message: string;
  contact: string | null;
  page: string | null;
  url: string | null;
  userAgent: string | null;
};

const CONTACT_MAX = 120;
const CATEGORY_SET = new Set<string>(FEEDBACK_CATEGORIES);

/** Validate public feedback payload before touching the database. */
export function parseFeedbackInput(
  body: Record<string, unknown>,
  fallbackUserAgent?: string | null,
): FeedbackInput {
  let category: FeedbackCategory = DEFAULT_FEEDBACK_CATEGORY;
  if (typeof body.category === 'string' && body.category.trim()) {
    const c = body.category.trim();
    if (!CATEGORY_SET.has(c)) {
      throw new ApiError(400, '反馈类型无效');
    }
    category = c as FeedbackCategory;
  }
  const message = requiredText(body.message, '反馈内容', 4000);
  let contact: string | null = null;
  if (typeof body.contact === 'string') {
    const trimmed = body.contact.trim();
    if (trimmed) {
      if (trimmed.length > CONTACT_MAX) {
        throw new ApiError(400, `联系方式最多 ${CONTACT_MAX} 字`);
      }
      contact = trimmed;
    }
  }
  const page = typeof body.page === 'string' ? body.page.trim().slice(0, 200) || null : null;
  const url = typeof body.url === 'string' ? body.url.trim().slice(0, 500) || null : null;
  const fromBody = typeof body.userAgent === 'string' ? body.userAgent.trim().slice(0, 500) : '';
  const fromHeader = (fallbackUserAgent ?? '').trim().slice(0, 500);
  const userAgent = fromBody || fromHeader || null;
  return { category, message, contact, page, url, userAgent };
}

export function assertFeedbackBodyObject(body: unknown): asserts body is Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, '请求必须为 JSON 对象');
  }
}
