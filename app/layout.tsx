import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: '财报智析｜上市公司财报直通与智能问答',
  description: '从交易所直通财报数据，提供结构化指标、可视化分析、原文提纲与智能问答。',
  openGraph: {
    title: '财报智析',
    description: '上市公司财报直通与智能问答',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '财报智析',
    description: '上市公司财报直通与智能问答',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
