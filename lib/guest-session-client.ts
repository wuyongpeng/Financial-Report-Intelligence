/** Once-per-page-load mint of fri_guest_session before conversation hydrate/ask. */
let guestBootstrap: Promise<void> | null = null;

export function ensureGuestCookie(): Promise<void> {
  if (!guestBootstrap) {
    // Do not tie this to a component AbortSignal: a fast remount must not cancel
    // the shared Set-Cookie round-trip for the rest of the page lifetime.
    guestBootstrap = fetch('/api/auth/guest', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(() => undefined)
      .catch(() => undefined);
  }
  return guestBootstrap;
}
