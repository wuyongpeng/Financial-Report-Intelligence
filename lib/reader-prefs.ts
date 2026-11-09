/** Browser reading preferences. Absent fields keep today's behavior except the default level. */

export const READING_LEVELS = ['beginner', 'intermediate', 'professional'] as const;

export type ReadingLevel = (typeof READING_LEVELS)[number];

export const READING_LEVEL_COPY: Record<ReadingLevel, { label: string; hint: string }> = {
  beginner: { label: '入门', hint: '面向财报新手，自动补充术语释义' },
  intermediate: { label: '进阶', hint: '具备财报基础，异常点附带简要说明' },
  professional: { label: '专业', hint: '面向投研专业用户，输出精简原始信息' },
};

export const SPEECH_RATES = [
  { value: 0.85, label: '较慢' },
  { value: 1, label: '正常' },
  { value: 1.15, label: '较快' },
  { value: 1.3, label: '很快' },
] as const;

export type ReaderPrefs = {
  readingLevel: ReadingLevel;
  /** When true, follow the deployed failover order. When false, `modelId` pins one provider. */
  autoModel: boolean;
  /** `auto` means no pin. Any other value is a provider id used only while autoModel is off. */
  modelId: string;
  welcome: boolean;
  /** Voice answers jump to the first cited page. Missing means on. */
  voiceCiteJump: boolean;
  speechRate: number;
  /** Session cache: send prior turns of the same report. */
  memory: boolean;
};

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  readingLevel: 'beginner',
  autoModel: true,
  modelId: 'auto',
  welcome: false,
  voiceCiteJump: true,
  speechRate: 1,
  memory: true,
};

export const READER_PREFS_KEY = 'eva_reader_prefs';

const MODEL_ID_RE = /^[\w./:@+-]+$/;

export function sanitizeReadingLevel(value: unknown): ReadingLevel | undefined {
  return value === 'beginner' || value === 'intermediate' || value === 'professional' ? value : undefined;
}

/** Provider id chosen by the reader. `auto` and junk become undefined so callers keep failover. */
export function sanitizeModelId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  if (!id || id === 'auto' || id.length > 120 || !MODEL_ID_RE.test(id)) return undefined;
  return id;
}

export function snapSpeechRate(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  let best: number = SPEECH_RATES[0].value;
  let dist = Infinity;
  for (const item of SPEECH_RATES) {
    const gap = Math.abs(item.value - n);
    if (gap < dist) {
      dist = gap;
      best = item.value;
    }
  }
  return best;
}

export function normalizeReaderPrefs(raw: unknown): ReaderPrefs {
  const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const modelId = sanitizeModelId(row.modelId) ?? 'auto';
  const autoModel = typeof row.autoModel === 'boolean' ? row.autoModel : modelId === 'auto';
  return {
    readingLevel: sanitizeReadingLevel(row.readingLevel) ?? DEFAULT_READER_PREFS.readingLevel,
    autoModel,
    modelId,
    welcome: row.welcome === true,
    voiceCiteJump: row.voiceCiteJump !== false,
    speechRate: snapSpeechRate(row.speechRate ?? DEFAULT_READER_PREFS.speechRate),
    memory: row.memory !== false,
  };
}

/** Extra system instruction. Citations stay mandatory in the base prompt. */
export function readingLevelInstruction(level: ReadingLevel, spoken: boolean): string {
  if (level === 'beginner') {
    return spoken
      ? '解读档位：入门。先给结论，最多再补半句术语白话。不要讲课，不要新增数字，保留必要出处。'
      : '解读档位：入门。结论之后，对首次出现的财报术语用括号补一句白话释义（如 ROE、扣非、同比口径）。释义只解释词，不新增数字，仍保留证据编号。';
  }
  if (level === 'intermediate') {
    return spoken
      ? '解读档位：进阶。先给结论。若有明显异常，用半句说明，不要展开。'
      : '解读档位：进阶。保持简洁。若证据里有明显异常或背离，用一句话说明含义，不要写成教材。';
  }
  return spoken
    ? '解读档位：专业。只说数字、口径和变化，不解释术语，不加背景。'
    : '解读档位：专业。不解释术语，不写背景。只给出数字、口径、变化和证据编号。';
}
