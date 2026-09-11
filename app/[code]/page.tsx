import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import CompanyCodeClient from './company-code-client';

export default async function CompanyCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^\d{6}$/.test(code)) notFound();
  return (
    <Suspense
      fallback={
        <main className="app-shell">
          <section className="lane-page">
            <div className="honest-empty"><b>正在打开 {code}</b><p>读取该公司财报与指标…</p></div>
          </section>
        </main>
      }
    >
      <CompanyCodeClient code={code} />
    </Suspense>
  );
}
