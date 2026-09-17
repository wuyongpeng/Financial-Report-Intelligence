import Link from 'next/link';
import { redirect } from 'next/navigation';
import ReportHome from './report-home';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const params = await searchParams;
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  if (code && /^\d{6}$/.test(code)) redirect(`/${code}`);

  return (
    <main className="app-shell">
      <header className="topbar home-topbar">
        <div className="home-topbar-spacer" aria-hidden="true" />
        <div className="top-actions">
          <Link className="rh-system-link" href="/sources" aria-label="打开数据采集">数据采集</Link>
        </div>
      </header>
      <ReportHome />
    </main>
  );
}
