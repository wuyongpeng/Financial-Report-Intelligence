import { ensureConversationOwner } from '@/lib/auth';
import { apiError, readObject, requiredText } from '@/lib/api';
import {
  generateAndStoreHomePrompts,
  readGuestHomePrompts,
  type HomePromptPeer,
} from '@/lib/home-prompts';

export const dynamic = 'force-dynamic';

function withCookie(body: unknown, status: number, setCookie?: string) {
  const headers = new Headers({ 'cache-control': 'no-store', 'content-type': 'application/json' });
  if (setCookie) headers.append('set-cookie', setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function optionalText(value: unknown, max = 80) {
  if (value == null) return undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > max) return undefined;
  return text;
}

function parsePeers(value: unknown): HomePromptPeer[] {
  if (!Array.isArray(value)) return [];
  const out: HomePromptPeer[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const code = typeof row.code === 'string' ? row.code.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!/^\d{6}$/.test(code) || !name) continue;
    out.push({ code, name });
    if (out.length >= 8) break;
  }
  return out;
}

export async function GET(request: Request) {
  try {
    const { owner, setCookie } = ensureConversationOwner(request);
    const stored = await readGuestHomePrompts(owner);
    return withCookie(
      {
        questions: stored?.questions ?? [],
        sourceQuestion: stored?.sourceQuestion,
        industry: stored?.industry ?? undefined,
        companyCode: stored?.companyCode ?? undefined,
      },
      200,
      setCookie,
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { owner, setCookie } = ensureConversationOwner(request);
    const body = await readObject(request);
    const question = requiredText(body.question, 'question', 200);
    const companyCode = optionalText(body.companyCode, 6);
    const companyName = optionalText(body.companyName, 80);
    const industryGroup = optionalText(body.industryGroup, 40);
    const peers = parsePeers(body.peers);
    const result = await generateAndStoreHomePrompts({
      ownerKey: owner,
      question,
      companyCode,
      companyName,
      industryGroup,
      peers,
    });
    return withCookie(
      { questions: result.questions, mode: result.mode, sourceQuestion: question },
      200,
      setCookie,
    );
  } catch (error) {
    return apiError(error);
  }
}
