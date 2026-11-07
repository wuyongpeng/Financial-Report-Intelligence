import { redirect } from 'next/navigation';
import { adminSourcesTarget, type AdminSearchParams } from '@/lib/admin-route';

/** Compatibility entry; keep all query parameters when entering data operations. */
export default async function SourcesRedirectPage({
  searchParams,
}: {
  searchParams: Promise<AdminSearchParams>;
}) {
  redirect(adminSourcesTarget(await searchParams));
}
