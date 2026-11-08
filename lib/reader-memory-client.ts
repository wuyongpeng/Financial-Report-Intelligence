import {
  EMPTY_READER_MEMORY,
  READER_MEMORY_KEY,
  addManualMemory,
  rememberExplicit,
  removeMemoryNote,
  type MemoryNote,
  type ReaderMemory,
} from './reader-memory';

export const READER_MEMORY_EVENT = 'eva-reader-memory';

function asNotes(value: unknown): MemoryNote[] {
  if (!Array.isArray(value)) return [];
  const notes: MemoryNote[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { id?: unknown; text?: unknown; source?: unknown; updatedAt?: unknown };
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    if (!id || !text) continue;
    if (id.startsWith('habit:') || id.startsWith('company:') || text.startsWith('提问常围绕')) continue;
    notes.push({
      id: id.slice(0, 120),
      text: text.slice(0, 80),
      source: row.source === 'saved' ? 'saved' : 'inferred',
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
    });
    if (notes.length >= 20) break;
  }
  return notes;
}

/** Older builds stored a question log. Those entries are not durable facts. */
function fromLegacy(_raw: Record<string, unknown>): MemoryNote[] {
  return [];
}

function normalize(raw: unknown): ReaderMemory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_READER_MEMORY;
  const row = raw as Record<string, unknown>;
  const notes = asNotes(row.notes);
  return { notes: notes.length ? notes : fromLegacy(row) };
}

function write(memory: ReaderMemory) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(READER_MEMORY_KEY, JSON.stringify(memory));
  window.dispatchEvent(new Event(READER_MEMORY_EVENT));
}

export function readReaderMemory(): ReaderMemory {
  if (typeof window === 'undefined') return EMPTY_READER_MEMORY;
  try {
    const raw = window.localStorage.getItem(READER_MEMORY_KEY);
    if (!raw) return EMPTY_READER_MEMORY;
    return normalize(JSON.parse(raw) as unknown);
  } catch {
    return EMPTY_READER_MEMORY;
  }
}

export function addReaderMemory(text: string): ReaderMemory {
  const next = addManualMemory(readReaderMemory(), text, new Date().toISOString());
  write(next);
  return next;
}

/** Write an explicit「记住……」into the local cache. Ordinary questions only read that cache. */
export function reflectReaderMemory(input: { question: string; context?: string }) {
  const question = input.question.replace(/\s+/g, ' ').trim();
  if (question.length < 2) return;
  const prev = readReaderMemory();
  const saved = rememberExplicit(prev, question, new Date().toISOString());
  if (JSON.stringify(saved) !== JSON.stringify(prev)) write(saved);
}

export function deleteReaderNote(id: string): ReaderMemory {
  const next = removeMemoryNote(readReaderMemory(), id);
  write(next);
  return next;
}

export function clearReaderMemory(): ReaderMemory {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(READER_MEMORY_KEY);
    window.dispatchEvent(new Event(READER_MEMORY_EVENT));
  }
  return EMPTY_READER_MEMORY;
}
