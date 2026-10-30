import { redirect } from 'next/navigation';
import ReportHome from './report-home';
import HomeOverflowMenu from './home-overflow-menu';

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
          <HomeOverflowMenu />
        </div>
      </header>
      <ReportHome />
    </main>
  );
}
