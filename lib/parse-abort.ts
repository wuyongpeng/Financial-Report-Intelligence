import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * 中止排队/进行中的 PDF 解析。
 * 终态落库为 parse_parked（退出自动排队解析）；手动「解析」经 enqueueParseFront 回到 downloaded。
 */

export const PARSE_ABORT_MESSAGE = '用户手动中止，已退出排队解析';
export const ABORT_REQUEST_TTL_MS = 5 * 60_000;
const ABORT_REQUEST_CAP = 100;

function runtimeFile(name: string) {
  return join(process.env.RUNTIME_DIR ?? resolve(/* turbopackIgnore: true */ process.cwd(), '.data'), name);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.part`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`);
  renameSync(temporary, file);
}

type AbortRequest = { id: string; at: number };

function abortRequestPath() {
  return runtimeFile('parse-aborts.json');
}

function readAbortRequests(now = Date.now()): AbortRequest[] {
  const parsed = readJson<{ items?: unknown }>(abortRequestPath(), {});
  if (!Array.isArray(parsed.items)) return [];
  return parsed.items
    .filter((item): item is AbortRequest => {
      if (!item || typeof item !== 'object') return false;
      const row = item as AbortRequest;
      return typeof row.id === 'string' && Boolean(row.id.trim()) && Number.isFinite(row.at);
    })
    .filter((item) => now - item.at <= ABORT_REQUEST_TTL_MS);
}

export function requestParseAbort(id: string) {
  const key = id.trim();
  if (!key) return;
  const items = readAbortRequests().filter((item) => item.id !== key);
  items.unshift({ id: key, at: Date.now() });
  writeJson(abortRequestPath(), { items: items.slice(0, ABORT_REQUEST_CAP) });
}

export function hasParseAbortRequest(id: string, now = Date.now()) {
  return readAbortRequests(now).some((item) => item.id === id);
}

export function consumeParseAbort(id: string, now = Date.now()): boolean {
  const items = readAbortRequests(now);
  if (!items.some((item) => item.id === id)) return false;
  writeJson(abortRequestPath(), { items: items.filter((item) => item.id !== id) });
  return true;
}

export function clearParseAbortRequests() {
  writeJson(abortRequestPath(), { items: [] });
}

const controllers = new Map<string, AbortController>();

export function registerParseRun(id: string): AbortController {
  const existing = controllers.get(id);
  if (existing && !existing.signal.aborted) existing.abort();
  const controller = new AbortController();
  controllers.set(id, controller);
  return controller;
}

export function releaseParseRun(id: string) {
  controllers.delete(id);
}

export function abortParseRun(id: string): boolean {
  const controller = controllers.get(id);
  if (!controller || controller.signal.aborted) return false;
  controller.abort();
  return true;
}

export function listParseRunIds() {
  return [...controllers.keys()];
}

/** 标题侧廉价启发：港股繁体年報 / H 股标记。 */
export function looksLikeHkTraditionalFiling(title: string) {
  const t = String(title ?? '').replace(/\s+/g, '');
  return /年報|H股|港股|繁體|香港交易所|聯交所|HKEX/i.test(t);
}

export function emptyTextParkMessage(title: string) {
  if (looksLikeHkTraditionalFiling(title)) {
    return '疑似港股繁体年報或无文字层，已搁置（可中止退出或稍后手动再解析）';
  }
  return '未能抽取正文（扫描件或无法读出文字），已搁置';
}
