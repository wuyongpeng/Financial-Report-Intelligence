import { Suspense } from 'react';
import { TestsAdminClient } from './tests-client';

export const dynamic = 'force-dynamic';

export default function AdminTestsPage() {
  return (
    <Suspense fallback={null}>
      <TestsAdminClient />
    </Suspense>
  );
}
