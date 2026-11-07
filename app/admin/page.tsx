import { redirect } from 'next/navigation';

/** Unified ops console lands on data collection (demo-friendly first tab). */
export default function AdminPage() {
  redirect('/admin/crawl');
}
