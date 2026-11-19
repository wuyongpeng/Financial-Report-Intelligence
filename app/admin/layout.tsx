import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { isAdmin } from '@/lib/auth';
import { AdminLoginForm } from './_components/admin-login-form';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const headerList = await headers();
  const request = new Request('http://localhost/admin', {
    headers: { cookie: headerList.get('cookie') ?? '' },
  });
  if (!isAdmin(request)) return <AdminLoginForm />;
  return children;
}
