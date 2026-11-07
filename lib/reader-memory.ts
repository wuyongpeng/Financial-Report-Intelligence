/** Saved reader memories. Each note is one sentence injected before an answer. */

export type MemoryNote = {
  id: string;
  text: string;
  /** observed: inferred from questions. saved: the user asked to remember it. */
  source: 'observed' | 'saved';
  updatedAt: string;
};

export type ReaderMemory = { notes: MemoryNote[] };

export const EMPTY_READER_MEMORY: ReaderMemory = { notes: [] };

export const READER_MEMORY_KEY = 'eva_reader_memory';

const TOPIC_RULES: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: 'why', label: '变化原因', pattern: /为什么|为何|原因/ },
  { key: 'compare', label: '公司对比', pattern: /对比|比较|同比|环比|同行|同业/ },
  { key: 'metric', label: '核心指标', pattern: /营收|营业收入|净利润|ROE|EPS|现金流|毛利|净资产/i },
  { key: 'change', label: '经营变化', pattern: /增长|下降|下滑|变好|变差|怎么样|是否缓慢/ },
  { key: 'risk', label: '风险与异常', pattern: /风险|异常|商誉|负债|减值/ },
  { key: 'guide', label: '怎么看财报', pattern: /怎么看|如何看|怎么读|从哪/ },
  { key: 'dividend', label: '分红', pattern: /分红|派息/ },
];

const EXPLICIT_PATTERNS = [
  /^(?:请)?(?:帮我)?记住[：:，,\s]*(.+)$/,
  /^以后(?:都|请|回答)?[，,\s]*(.+)$/,
  /^我希望(?:你)?(?:以后)?[，,\s]*(.+)$/,
  /^回答(?:的时候|时)(?:请|要)?[，,\s]*(.+)$/,
];

export function explicitMemoryText(question: string): string | null {
  const text = question.replace(/\s+/g, ' ').trim();
  for (const pattern of EXPLICIT_PATTERNS) {
    const captured = text.match(pattern)?.[1]?.trim();
    if (captured && captured.length >= 2) return captured.slice(0, 80);
  }
  return null;
}

function upsert(notes: MemoryNote[], note: MemoryNote): MemoryNote[] {
  const rest = notes.filter((item) => item.id !== note.id);
  return [note, ...rest].slice(0, 20);
}

export function applyReaderActivity(
  memory: ReaderMemory,
  input: { question?: string; code?: string; name?: string; at?: string },
): ReaderMemory {
  let notes = memory.notes.map((item) => ({ ...item }));
  const at = input.at ?? new Date(0).toISOString();
  const code = (input.code ?? '').trim();
  const name = (input.name ?? '').trim();
  if (/^\d{6}$/.test(code) && name) {
    notes = upsert(notes, {
      id: `company:${code}`,
      text: `关注${name}`,
      source: 'observed',
      updatedAt: at,
    });
  }
  const compact = (input.question ?? '').replace(/\s+/g, '');
  const explicit = explicitMemoryText(input.question ?? '');
  if (explicit) {
    notes = upsert(notes, {
      id: `saved:${explicit}`,
      text: explicit,
      source: 'saved',
      updatedAt: at,
    });
  }
  if (compact.length >= 2 && !explicit) {
    for (const rule of TOPIC_RULES) {
      if (!rule.pattern.test(compact)) continue;
      notes = upsert(notes, {
        id: `habit:${rule.key}`,
        text: `提问常围绕${rule.label}`,
        source: 'observed',
        updatedAt: at,
      });
    }
  }
  return { notes };
}

export function removeMemoryNote(memory: ReaderMemory, id: string): ReaderMemory {
  return { notes: memory.notes.filter((item) => item.id !== id) };
}

/** One line for the answer prompt. Empty when there is nothing to remember. */
export function memoryPrompt(memory: ReaderMemory): string {
  const texts = memory.notes.map((item) => item.text.trim()).filter(Boolean);
  if (!texts.length) return '';
  return texts.join('；').slice(0, 400);
}
