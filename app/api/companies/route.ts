import companies from '@/data/companies.json';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ count: companies.length, companies, generatedAt: new Date().toISOString() });
}
