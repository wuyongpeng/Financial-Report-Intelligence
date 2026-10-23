/**
 * Client-safe helpers for personalized homepage placeholders.
 * Keep free of db / LLM imports so report-home can bundle this.
 */

import {
  extractFollowupText,
  isGenericFollowup,
  normaliseFollowup,
  topicFromQuestion,
} from './chat-followups';
import { FALLBACK_PLACEHOLDER_SEEDS, shortCompanyName } from './home-placeholders';

export const MAX_PERSONALIZED_HOME_PROMPTS = 4;

export type HomePromptPeer = { code: string; name: string };

function asHomeQuestion(line: string) {
  const text = line.replace(/^[\s\-*•·\d.、)）]+/, '').replace(/["“”']/g, '').trim();
  if (!text) return '';
  const withMark = /[？?]$/.test(text)
    ? text.replace(/[?]$/, '？')
    : (/吗|什么|为何|为什么|怎么|如何|多少|哪些|哪项|是否|几何|对比|分析/.test(text) ? `${text}？` : '');
  if (!withMark) return '';
  if (withMark.length < 6 || withMark.length > 48) return '';
  if (isGenericFollowup(withMark)) return '';
  return withMark;
}

/** Parse model output into 3–4 home-style short questions. */
export function parseHomePromptQuestions(raw: string, exclude: string[] = [], limit = MAX_PERSONALIZED_HOME_PROMPTS) {
  const seen = new Set(exclude.map(normaliseFollowup).filter(Boolean));
  const out: string[] = [];
  for (const line of extractFollowupText(raw).split(/\n+/)) {
    const question = asHomeQuestion(line);
    if (!question) continue;
    const key = normaliseFollowup(question);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(question);
    if (out.length >= limit) break;
  }
  return out;
}

/** Deterministic fallback when LLM is off or returns nothing. */
export function contextualHomePrompts(input: {
  question: string;
  companyName?: string;
  companyCode?: string;
  industryGroup?: string | null;
  peers?: HomePromptPeer[];
}) {
  const topic = topicFromQuestion(input.question);
  const self = input.companyName ? shortCompanyName(input.companyName) : '';
  const peers = (input.peers ?? [])
    .filter((p) => p.name && p.code !== input.companyCode)
    .map((p) => shortCompanyName(p.name))
    .filter(Boolean);
  const industryPeers = peers.length
    ? peers
    : FALLBACK_PLACEHOLDER_SEEDS
        .filter((s) => s.industryGroup && s.industryGroup === (input.industryGroup || ''))
        .map((s) => shortCompanyName(s.name))
        .filter((n) => n !== self);
  const peerA = industryPeers[0] ?? '同行龙头';
  const peerB = industryPeers[1] ?? peerA;
  const candidates = [
    self ? `${self}${topic}和上年同期比如何？` : `${topic}和上年同期比如何？`,
    self ? `${self}${topic}变化的主要原因？` : `${topic}变化的主要原因？`,
    peerA !== self ? `${peerA}的${topic}表现如何？` : `同行的${topic}处于什么水位？`,
    peerA && peerB && peerA !== peerB
      ? `对比${peerA}和${peerB}的${topic}`
      : self
        ? `${self}盈利质量和同行比如何？`
        : `同行业${topic}谁更强？`,
  ];
  const seen = new Set([normaliseFollowup(input.question)].filter(Boolean));
  const out: string[] = [];
  for (const item of candidates) {
    const q = asHomeQuestion(item) || (/[？?]$/.test(item) ? item.replace(/[?]$/, '？') : '');
    if (!q || isGenericFollowup(q)) continue;
    const key = normaliseFollowup(q);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= MAX_PERSONALIZED_HOME_PROMPTS) break;
  }
  return out;
}

export function mergeHomePromptLists(generated: string[], fallback: string[], exclude: string[] = []) {
  const seen = new Set(exclude.map(normaliseFollowup).filter(Boolean));
  const out: string[] = [];
  for (const item of [...generated, ...fallback]) {
    const q = asHomeQuestion(item) || (/[？?]$/.test(item.trim()) ? item.trim().replace(/[?]$/, '？') : '');
    if (!q || isGenericFollowup(q)) continue;
    const key = normaliseFollowup(q);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= MAX_PERSONALIZED_HOME_PROMPTS) break;
  }
  return out;
}

/** Prepend personalized questions ahead of the rotating base list; dedupe by normalised text. */
export function prependPersonalizedPlaceholders(personalized: string[], base: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...personalized, ...base]) {
    const text = item.trim();
    if (!text) continue;
    const key = normaliseFollowup(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}
