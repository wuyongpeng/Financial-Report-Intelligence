export async function sendAlert(title: string, detail: Record<string, unknown>) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, service: 'financial-report-intelligence', occurredAt: new Date().toISOString(), detail }),
      signal: controller.signal,
    });
    if (!response.ok) console.error('[alert] webhook rejected request', response.status);
  } catch (error) {
    console.error('[alert] webhook delivery failed', error);
  } finally {
    clearTimeout(timer);
  }
}
