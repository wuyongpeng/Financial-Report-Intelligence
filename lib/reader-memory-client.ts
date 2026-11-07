import {
  EMPTY_READER_MEMORY,
  READER_MEMORY_KEY,
  applyReaderActivity,
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
    notes.push({
      id: id.slice(0, 120),
      text: text.slice(0, 80),
      source: row.source === 'saved' ? 'saved' : 'observed',
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
    });
    if (notes.length >= 20) break;
  }
  return notes;
}

/** Older builds stored companies/topics instead of sentences. */
function fromLegacy(raw: Record<string, unknown>): MemoryNote[] {
  const notes: MemoryNote[] = [];
  if (Array.isArray(raw.companies)) {
    for (const item of raw.companies) {
      if (!item || typeof item !== 'object') continue;
      const company = item as { code?: unknown; name?: unknown };
      const code = typeof company.code === 'string' ? company.code : '';
      const name = typeof company.name === 'string' ? company.name.trim() : '';
      if (!/^\d{6}$/.test(code) || !name) continue;
      notes.push({ id: `company:${code}`, text: `关注${name}`, source: 'observed', updatedAt: '' });
    }
  }
  if (Array.isArray(raw.topics)) {
    for (const item of raw.topics) {
      if (!item || typeof item !== 'object') continue;
      const topic = item as { key?: unknown; label?: unknown; count?: unknown };
      const key = typeof topic.key === 'string' ? topic.key : '';
      const label = typeof topic.label === 'string' ? topic.label : '';
      const count = typeof topic.count === 'number' ? topic.count : 0;
      if (!key || !label || count <= 0) continue;
      notes.push({ id: `habit:${key}`, text: `提问常围绕${label}`, source: 'observed', updatedAt: '' });
    }
  }
  return notes.slice(0, 20);
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

export function noteReaderActivity(input: { question?: string; code?: string; name?: string }): ReaderMemory {
  const prev = readReaderMemory();
  const next = applyReaderActivity(prev, { ...input, at: new Date().toISOString() });
  if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
  write(next);
  return next;
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
