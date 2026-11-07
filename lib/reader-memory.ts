/** Saved reader memories. Each note is one sentence injected before an answer. */

export type MemoryNote = {
  id: string;
  text: string;
  /** saved: the user wrote it. inferred: a later turn replaced or added a durable fact. */
  source: 'saved' | 'inferred';
  updatedAt: string;
};

export type ReaderMemory = { notes: MemoryNote[] };

export const EMPTY_READER_MEMORY: ReaderMemory = { notes: [] };

export const READER_MEMORY_KEY = 'eva_reader_memory';

const MAX_NOTES = 12;

const EXPLICIT_PATTERNS = [
  /^(?:请)?(?:帮我)?记住[：:，,\s]*(.+)$/,
  /^以后(?:都|请|回答)?[，,\s]*(.+)$/,
  /^我希望(?:你)?(?:以后)?[，,\s]*(.+)$/,
  /^回答(?:的时候|时)(?:请|要)?[，,\s]*(.+)$/,
];

export type MemoryPatch =
  | { action: 'none' }
  | { action: 'save'; text: string; replaces?: string }
  | { action: 'forget'; id: string };

export function explicitMemoryText(question: string): string | null {
  const text = question.replace(/\s+/g, ' ').trim();
  for (const pattern of EXPLICIT_PATTERNS) {
    const captured = text.match(pattern)?.[1]?.trim();
    if (captured && captured.length >= 2 && !/[？?]/.test(captured)) return captured.slice(0, 80);
  }
  return null;
}

function cleanFact(value: string): string | null {
  const text = value.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (text.length < 2 || /[？?]/.test(text)) return null;
  return text;
}

function noteId(text: string): string {
  return `fact:${text.replace(/\s+/g, '').slice(0, 40)}`;
}

function cap(notes: MemoryNote[]): MemoryNote[] {
  return notes.slice(0, MAX_NOTES);
}

function upsert(notes: MemoryNote[], note: MemoryNote): MemoryNote[] {
  const rest = notes.filter((item) => item.id !== note.id && item.text !== note.text);
  return cap([note, ...rest]);
}

/** User asked to remember something. A normal question changes nothing. */
export function rememberExplicit(
  memory: ReaderMemory,
  question: string,
  at: string,
): ReaderMemory {
  const text = explicitMemoryText(question);
  if (!text) return memory;
  return { notes: upsert(memory.notes, { id: noteId(text), text, source: 'saved', updatedAt: at }) };
}

/** Same store as inferred memories: one durable sentence, not a second log. */
export function addManualMemory(memory: ReaderMemory, raw: string, at: string): ReaderMemory {
  const text = cleanFact(raw);
  if (!text) return memory;
  return { notes: upsert(memory.notes, { id: noteId(text), text, source: 'saved', updatedAt: at }) };
}

export function parseMemoryPatch(value: unknown): MemoryPatch | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as { action?: unknown; text?: unknown; replaces?: unknown; id?: unknown };
  if (row.action === 'none') return { action: 'none' };
  if (row.action === 'forget') {
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id || id.length > 80) return null;
    return { action: 'forget', id };
  }
  if (row.action === 'save') {
    const text = typeof row.text === 'string' ? cleanFact(row.text) : null;
    if (!text) return null;
    const replaces = typeof row.replaces === 'string' ? row.replaces.trim() : '';
    return replaces ? { action: 'save', text, replaces } : { action: 'save', text };
  }
  return null;
}

/** Merge one model decision into the durable set. Conflicting facts replace, they do not stack. */
export function applyMemoryPatch(memory: ReaderMemory, patch: MemoryPatch, at: string): ReaderMemory {
  if (patch.action === 'none') return memory;
  if (patch.action === 'forget') return { notes: memory.notes.filter((item) => item.id !== patch.id) };
  const text = cleanFact(patch.text);
  if (!text) return memory;
  const prior = patch.replaces ? memory.notes.find((item) => item.id === patch.replaces) : undefined;
  const note: MemoryNote = {
    id: prior?.id ?? noteId(text),
    text,
    source: prior?.source === 'saved' ? 'saved' : 'inferred',
    updatedAt: at,
  };
  const rest = memory.notes.filter((item) => item.id !== note.id && item.id !== patch.replaces && item.text !== text);
  return { notes: cap([note, ...rest]) };
}

export function removeMemoryNote(memory: ReaderMemory, id: string): ReaderMemory {
  return { notes: memory.notes.filter((item) => item.id !== id) };
}

function grams(text: string): string[] {
  const compact = text.replace(/\s+/g, '');
  const out = (compact.match(/[A-Za-z0-9]{2,}/g) ?? []).map((item) => item.toLowerCase());
  for (let i = 0; i < compact.length - 1; i += 1) {
    const pair = compact.slice(i, i + 2);
    if (/^[\u4e00-\u9fff]{2}$/.test(pair)) out.push(pair);
  }
  return out;
}

/** Saved facts always travel. Inferred facts travel only when this question touches them. */
export function selectMemories(memory: ReaderMemory, question = ''): MemoryNote[] {
  const notes = memory.notes.filter((item) => item.text.trim());
  const saved = notes.filter((item) => item.source === 'saved');
  const inferred = notes.filter((item) => item.source !== 'saved');
  const query = new Set(grams(question));
  const related = query.size
    ? inferred.filter((item) => grams(item.text).some((token) => query.has(token)))
    : inferred.slice(0, 4);
  const seen = new Set<string>();
  const picked: MemoryNote[] = [];
  for (const item of [...saved, ...related]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    picked.push(item);
    if (picked.length >= 8) break;
  }
  return picked;
}

/** One line for the answer prompt. Empty when nothing relevant is stored. */
export function memoryPrompt(memory: ReaderMemory, question = ''): string {
  const texts = selectMemories(memory, question).map((item) => item.text.trim()).filter(Boolean);
  if (!texts.length) return '';
  return texts.join('；').slice(0, 400);
}
