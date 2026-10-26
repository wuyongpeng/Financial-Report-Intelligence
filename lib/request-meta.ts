/** Client network / browser headers available on anonymous requests. */

export type RequestMeta = {
  ip: string | null;
  userAgent: string | null;
  acceptLanguage: string | null;
  referer: string | null;
};

function firstForwarded(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

/** Prefer reverse-proxy headers (Caddy), then socket-ish fallbacks. */
export function readRequestMeta(request: Request): RequestMeta {
  const headers = request.headers;
  const ip =
    firstForwarded(headers.get('x-forwarded-for'))
    ?? headers.get('x-real-ip')
    ?? headers.get('cf-connecting-ip')
    ?? null;
  return {
    ip,
    userAgent: headers.get('user-agent'),
    acceptLanguage: headers.get('accept-language'),
    referer: headers.get('referer'),
  };
}
