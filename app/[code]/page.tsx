import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import companiesJson from '@/data/companies.json';
import { openingCompanyLabel } from '@/lib/crawl-display';
import CompanyCodeClient from './company-code-client';

const namesByCode = new Map((companiesJson as Array<{ code: string; name: string }>).map((item) => [item.code, item.name]));

export default async function CompanyCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^\d{6}$/.test(code)) notFound();
  const label = openingCompanyLabel(code, namesByCode.get(code));
  return (
    <Suspense
      fallback={
        <main className="app-shell">
          <section className="lane-page">
          <div className="honest-empty page-opening">
            <span className="page-opening-spin" aria-hidden="true" />
            <b>正在打开 {label}</b>
            <p>读取该公司财报与指标…</p>
          </div>
          </section>
        </main>
      }
    >
      <CompanyCodeClient code={code} />
    </Suspense>
  );
}
