import { memoryPrompt } from './reader-memory';
import { readReaderMemory } from './reader-memory-client';
import {
  DEFAULT_READER_PREFS,
  READER_PREFS_KEY,
  normalizeReaderPrefs,
  sanitizeModelId,
  type ReaderPrefs,
} from './reader-prefs';

export const MEMORY_CLEARED_EVENT = 'eva-memory-cleared';
export const CONVERSATION_DELETED_EVENT = 'eva-conversation-deleted';

export function readReaderPrefs(): ReaderPrefs {
  if (typeof window === 'undefined') return DEFAULT_READER_PREFS;
  try {
    const raw = window.localStorage.getItem(READER_PREFS_KEY);
    if (!raw) return DEFAULT_READER_PREFS;
    return normalizeReaderPrefs(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_READER_PREFS;
  }
}

export function writeReaderPrefs(next: ReaderPrefs): ReaderPrefs {
  const prefs = normalizeReaderPrefs(next);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(READER_PREFS_KEY, JSON.stringify(prefs));
  }
  return prefs;
}

export function updateReaderPrefs(patch: Partial<ReaderPrefs>): ReaderPrefs {
  return writeReaderPrefs({ ...readReaderPrefs(), ...patch });
}

/** Fields the detail ask should send. Omitted modelId means server-side auto failover. */
export function readerChatFields(question = ''): { readingLevel: ReaderPrefs['readingLevel']; modelId?: string; readerMemory?: string } {
  const prefs = readReaderPrefs();
  const modelId = prefs.autoModel ? undefined : sanitizeModelId(prefs.modelId);
  const brief = memoryPrompt(readReaderMemory(), question);
  return {
    readingLevel: prefs.readingLevel,
    ...(modelId ? { modelId } : {}),
    ...(brief ? { readerMemory: brief } : {}),
  };
}

export function readerHistory<T>(rows: T[]): T[] {
  return readReaderPrefs().memory ? rows : [];
}

export function notifyMemoryCleared() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(MEMORY_CLEARED_EVENT));
}

export function notifyConversationDeleted(id: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CONVERSATION_DELETED_EVENT, { detail: id }));
}
