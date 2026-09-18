import { acceptVerdictPayload, type ReportVerdict } from './report-verdict';

const DEFAULT_POLL_MS = 1500;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

type VerdictRequestOptions = {
  fill?: boolean;
  refresh?: boolean;
  signal?: AbortSignal;
  pollMs?: number;
  timeoutMs?: number;
};

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function asError(payload: { error?: string }, fallback: string) {
  return payload.error?.trim() || fallback;
}

async function readPayload(response: Response) {
  return await response.json().catch(() => ({})) as { error?: string; status?: string };
}

/**
 * POST returns quickly (202) while the model runs in the app process.
 * Poll GET until ready so APISIX/Caddy 60s gateways do not 504.
 */
export async function requestReportVerdict(reportId: string, options: VerdictRequestOptions = {}): Promise<ReportVerdict> {
  const headers = { 'content-type': 'application/json' };
  if (options.refresh || options.fill) {
    const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}/verdict`, {
      method: 'POST',
      cache: 'no-store',
      headers,
      body: JSON.stringify(options.refresh ? { refresh: true } : { fill: true }),
      signal: options.signal,
    });
    const payload = await readPayload(response);
    if (response.status === 200) {
      const parsed = acceptVerdictPayload(payload);
      if (parsed) return parsed;
    }
    if (!response.ok) throw new Error(asError(payload, '智析失败'));
  }

  const pollMs = Math.max(200, options.pollMs ?? DEFAULT_POLL_MS);
  const timeoutMs = Math.max(pollMs, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}/verdict`, {
      cache: 'no-store',
      signal: options.signal,
    });
    const payload = await readPayload(response);
    if (response.status === 200) {
      const parsed = acceptVerdictPayload(payload);
      if (parsed) return parsed;
      throw new Error('AI 返回格式无法解析，请稍后再试。');
    }
    if (response.status === 202) {
      await sleep(pollMs, options.signal);
      continue;
    }
    throw new Error(asError(payload, '智析失败'));
  }
  throw new Error('智析仍在生成，请稍后刷新页面查看。');
}
