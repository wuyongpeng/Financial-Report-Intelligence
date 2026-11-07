export type AdminSearchParams = Record<string, string | string[] | undefined>;

/** Preserve focus, repeated query keys and future filters on historical entry points. */
export function adminSourcesTarget(params: AdminSearchParams = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, item);
    }
  }
  const suffix = query.toString();
  return `/admin/sources${suffix ? `?${suffix}` : ''}`;
}
