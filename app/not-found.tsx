import Link from 'next/link';
import './not-found.css';

export default function NotFound() {
  return (
    <main className="nf-page">
      <div className="nf-card">
        <p className="nf-code" aria-hidden="true">404<span>｜</span>Not Found</p>
        <h1 className="nf-title">页面不存在</h1>
        <p className="nf-hint">这个地址没有对应页面，或链接写错了。</p>
        <div className="nf-actions">
          <Link className="nf-primary" href="/">返回首页</Link>
          <Link className="nf-secondary" href="/docs">帮助中心</Link>
        </div>
      </div>
    </main>
  );
}
