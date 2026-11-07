import { redirect } from 'next/navigation';

/** Legacy /sources → unified ops console crawl tab (keep ?focus=). */
export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const focusRaw = params.focus;
  const focus = Array.isArray(focusRaw) ? focusRaw[0] : focusRaw;
  const qs = focus ? `?focus=${encodeURIComponent(focus)}` : '';
  redirect(`/admin/crawl${qs}`);
}
