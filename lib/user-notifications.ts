import { ensureBackendSchema } from './backend-schema';
import { getDb } from './db';
import { absoluteAppUrl, sendMail } from './mailer';
import { markNotifiedPeriod, watchersForCode } from './user-watchlist';

export type NotificationType = 'new_report' | 'ready';

export type UserNotification = {
  id: string;
  type: string;
  code: string;
  period: string;
  reportId: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  type: string;
  code: string;
  period: string | null;
  report_id: string | null;
  title: string;
  body: string;
  href: string | null;
  read_at: string | Date | null;
  created_at: string | Date;
};

function asNotification(row: NotificationRow): UserNotification {
  return {
    id: String(row.id),
    type: row.type,
    code: row.code,
    period: row.period ?? '',
    reportId: row.report_id ?? '',
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function reportHref(code: string, period?: string, reportId?: string) {
  const params = new URLSearchParams();
  if (period) params.set('period', period);
  if (reportId) params.set('report', reportId);
  const query = params.toString();
  return `/${code}${query ? `?${query}` : ''}`;
}

export async function listNotifications(userKey: string, opts?: { unreadOnly?: boolean; limit?: number }) {
  await ensureBackendSchema();
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
  const rows = opts?.unreadOnly
    ? await getDb()<NotificationRow[]>`SELECT * FROM user_notifications WHERE user_key=${userKey} AND read_at IS NULL ORDER BY created_at DESC LIMIT ${limit}`
    : await getDb()<NotificationRow[]>`SELECT * FROM user_notifications WHERE user_key=${userKey} ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map(asNotification);
}

export async function unreadNotificationCount(userKey: string) {
  await ensureBackendSchema();
  const [row] = await getDb()<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM user_notifications WHERE user_key=${userKey} AND read_at IS NULL
  `;
  return row?.n ?? 0;
}

export async function markNotificationRead(userKey: string, id: string) {
  await ensureBackendSchema();
  await getDb()`UPDATE user_notifications SET read_at=NOW() WHERE id=${id} AND user_key=${userKey} AND read_at IS NULL`;
}

export async function markAllNotificationsRead(userKey: string) {
  await ensureBackendSchema();
  await getDb()`UPDATE user_notifications SET read_at=NOW() WHERE user_key=${userKey} AND read_at IS NULL`;
}

export async function deleteUserNotifications(userKey: string) {
  await ensureBackendSchema();
  await getDb()`DELETE FROM user_notifications WHERE user_key=${userKey}`;
}

async function emailForUser(userKey: string) {
  const [row] = await getDb()<Array<{ email: string | null; email_notify: boolean }>>`
    SELECT email, email_notify FROM app_users WHERE username_key=${userKey} LIMIT 1
  `;
  if (!row?.email || row.email_notify === false) return null;
  return row.email;
}

export async function createNotification(input: {
  userKey: string;
  type: NotificationType;
  code: string;
  period?: string;
  reportId?: string;
  title: string;
  body: string;
  href?: string;
  emailSubject?: string;
}) {
  await ensureBackendSchema();
  const period = input.period ?? '';
  const reportId = input.reportId ?? '';
  const href = input.href ?? reportHref(input.code, period || undefined, reportId || undefined);
  const inserted = await getDb()<NotificationRow[]>`
    INSERT INTO user_notifications (user_key, type, code, period, report_id, title, body, href)
    VALUES (${input.userKey}, ${input.type}, ${input.code}, ${period}, ${reportId}, ${input.title}, ${input.body}, ${href})
    ON CONFLICT (user_key, type, code, period, report_id) DO NOTHING
    RETURNING *
  `;
  if (!inserted.length) return null;
  const notification = asNotification(inserted[0]);
  if (period) await markNotifiedPeriod(input.userKey, input.code, period);
  const email = await emailForUser(input.userKey);
  if (email) {
    const link = absoluteAppUrl(href);
    void sendMail({
      to: email,
      subject: input.emailSubject ?? input.title,
      text: `${input.body}\n\n${link}`,
    });
  }
  return notification;
}

export async function notifyWatchersOfNewReport(input: {
  code: string;
  companyName: string;
  period: string;
  reportId: string;
}) {
  const watchers = await watchersForCode(input.code);
  if (!watchers.length) return 0;
  const href = reportHref(input.code, input.period, input.reportId);
  const title = `${input.companyName} 发布了 ${input.period} 报告`;
  const body = `你自选的「${input.companyName}」${input.period} 报告已可阅读，点开即可查看本期分析。`;
  let count = 0;
  for (const userKey of watchers) {
    const created = await createNotification({
      userKey,
      type: 'new_report',
      code: input.code,
      period: input.period,
      reportId: input.reportId,
      title,
      body,
      href,
      emailSubject: title,
    });
    if (created) count += 1;
  }
  return count;
}

export async function notifyWatcherReady(input: {
  userKey: string;
  code: string;
  companyName: string;
  period?: string;
  reportId?: string;
}) {
  const periodLabel = input.period ? `${input.period} 报告` : '报告';
  return createNotification({
    userKey: input.userKey,
    type: 'ready',
    code: input.code,
    period: input.period,
    reportId: input.reportId,
    title: `「${input.companyName}」${periodLabel}已准备好`,
    body: `你加入自选的「${input.companyName}」已可阅读，点开即可查看本期分析。`,
  });
}
