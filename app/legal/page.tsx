import Link from 'next/link';
import { ProductFooter } from '@/components/product-workspace';
import { LEGAL_PAGES, legalPath } from '@/lib/legal-content';
import '@/components/product-workspace.css';

export const metadata = { title: '服务条款 · Eva' };

export default function LegalIndexPage() {
  return (
    <main className="pw-legal">
      <h1>服务条款</h1>
      <p>使用 Eva 前，请阅读以下说明。以下页面构成本产品的服务条款。</p>
      <ul className="pw-legal-index">
        {LEGAL_PAGES.map((page) => (
          <li key={page.slug}>
            <Link href={legalPath(page.slug)}>{page.title}</Link>
          </li>
        ))}
      </ul>
      <ProductFooter />
    </main>
  );
}
