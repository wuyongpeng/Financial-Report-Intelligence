import { notFound } from 'next/navigation';
import { ProductFooter } from '@/components/product-workspace';
import { findLegalPage, LEGAL_PAGES } from '@/lib/legal-content';
import '@/components/product-workspace.css';

export function generateStaticParams() {
  return LEGAL_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const page = findLegalPage((await params).slug);
  return { title: page ? `${page.title} · Eva` : 'Eva' };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = findLegalPage((await params).slug);
  if (!page) notFound();
  return (
    <main className="pw-legal">
      <h1>{page.title}</h1>
      {page.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      <ProductFooter />
    </main>
  );
}
