import {
  EMPTY_READER_MEMORY,
  READER_MEMORY_KEY,
  applyReaderActivity,
  type ReaderMemory,
} from './reader-memory';

export const READER_MEMORY_EVENT = 'eva-reader-memory';

function normalize(raw: unknown): ReaderMemory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_READER_MEMORY;
  const row = raw as { companies?: unknown; topics?: unknown };
  const companies = Array.isArray(row.companies)
    ? row.companies.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const company = item as { code?: unknown; name?: unknown; count?: unknown };
      const code = typeof company.code === 'string' ? company.code : '';
      const name = typeof company.name === 'string' ? company.name.trim() : '';
      const count = typeof company.count === 'number' && company.count > 0 ? Math.round(company.count) : 0;
      return /^\d{6}$/.test(code) && name && count ? [{ code, name, count }] : [];
    }).slice(0, 8)
    : [];
  const topics = Array.isArray(row.topics)
    ? row.topics.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const topic = item as { key?: unknown; label?: unknown; count?: unknown };
      const key = typeof topic.key === 'string' ? topic.key : '';
      const label = typeof topic.label === 'string' ? topic.label : '';
      const count = typeof topic.count === 'number' && topic.count > 0 ? Math.round(topic.count) : 0;
      return key && label && count ? [{ key, label, count }] : [];
    })
    : [];
  return { companies, topics };
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
  const next = applyReaderActivity(prev, input);
  if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(READER_MEMORY_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(READER_MEMORY_EVENT));
  }
  return next;
}

export function clearReaderMemory(): ReaderMemory {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(READER_MEMORY_KEY);
    window.dispatchEvent(new Event(READER_MEMORY_EVENT));
  }
  return EMPTY_READER_MEMORY;
}
