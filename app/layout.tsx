import type { Metadata } from 'next';
import AppProviders from './providers';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://financial-report-intelligence.wuyongpeng.chatgpt.site'),
  title: 'Eva - 财报智能分析助手',
  description: '财报发布后快速上线，主动发现关键变化，并让每个数字和结论都能回到原始财报验证。',
  openGraph: {
    title: 'Eva - 财报智能分析助手',
    description: '快速上线、主动发现、每个结论可验证',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Eva - 财报智能分析助手',
    description: '快速上线、主动发现、每个结论可验证',
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
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
