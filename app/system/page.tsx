import { redirect } from 'next/navigation';

export default function LegacyOpsRedirectPage() {
  redirect('/admin/crawl');
}
