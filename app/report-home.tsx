'use client';
import { requestAssistantTurn, FEEDBACK_REVIEW_LINE } from '@/lib/assistant-turn';
import { requestFeedbackDraft, subscribeFeedbackState, isFeedbackDrawerOpen } from '@/lib/feedback-draft-client';
import { shouldExpandHomeVoicePanel } from '@/lib/voice/home-panel';
import { useVoiceFloatDrag } from '@/components/use-voice-float-drag';
import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  freshnessAt,
  freshnessLabel,
  freshnessTooltip,
  formatMetricValue,
  hasDownloadedPdf,
  hasReadableMetrics,
  INDUSTRY_CHIPS,
  periodDisplay,
  pickRecentPeriods,
  describeYoy,
  formatYoyBadge,
  resolveYoy,
  yoyChange,
  yoyTone,
  type CrawlCompanyCoverage,
  type CrawlStats,
  type IndustryGroup,
  type YoyResult,
} from '@/lib/crawl-display';
import {
  buildCompanyAskUrl,
  coverageHasMatchingReport,
  hasQuestionIntent,
  matchCompanies,
  matchCompany,
  parseHomeQuery,
  queryMatchesCompany,
  resolveListedCompanies,
  resolveListedCompany,
  periodLabelZh,
  pickBestReport,
  type ListedNameCode,
  type ParsedPeriod,
} from '@/lib/home-search';
import {
  buildVoiceConfirmPrompt,
  buildVoiceJoinPrompt,
  buildVoicePickPrompt,
  needsVoiceCompanyConfirm,
  matchedVoiceSearchText,
  homeVoiceFinalizeText,
  parseVoiceConfirmReply,
  parseVoiceJoinReply,
  parseVoicePickChoice,
} from '@/lib/home-voice-flow';
import {
  HOME_CHITCHAT_SNAPSHOT_PLACEHOLDER,
  homeChitchatFallback,
  isHomeChitchatUtterance,
  isLikelyHomeChitchat,
  looksLikeUnresolvedCompanyAsk,
  sanitizeHomeAssistantText,
  shouldIgnoreHomeCompanyFilter,
} from '@/lib/home-chitchat';
import { metricYoyHoverDetail, type Report } from '@/lib/detail-model';
import { readContractJson } from '@/contracts/common';
import { parseReportListResponse } from '@/contracts/reports';
import { buildHomePlaceholders, DEFAULT_HOME_PLACEHOLDERS, type PlaceholderSeed } from '@/lib/home-placeholders';
import { prependPersonalizedPlaceholders } from '@/lib/home-prompts-shared';
import { ensureGuestCookie } from '@/lib/guest-session-client';
import { useVoiceSession, type VoiceUtteranceResult } from '@/components/voice-session-provider';
import { VoiceActivity, VoiceActivityStatus, voiceActivityState } from '@/components/voice-activity';
import '@/app/voice-float.css';
import { correctAsrHomophones } from '@/lib/voice/asr-correct';
import { isVoiceFarewell, pickVoiceFarewellLine } from '@/lib/voice/farewell-intent';
import { isVoiceGreetingOrNoise } from '@/lib/voice/greeting-intent';
import { speakAnswer } from '@/lib/voice/client-tts';
import { HomeVoiceTurns, assertHomeVoiceTurn, acceptsHomeBargeSpeech, type HomeVoiceTurn } from '@/lib/voice/home-turn';
import {
  appendHomeChatTurn,
  clearHomeChatTurns,
  getHomeChatTurns,
  markHomeAskHandoff,
} from '@/lib/chat-surface';
import {
  homeRosterSourcePreference,
  isHomeRosterQuestion,
} from '@/lib/home-roster-intent';
import { answerHomeRosterLocally } from '@/lib/home-roster-answer';
import {
  buildHomeRosterRows,
  formatHomeRosterSnapshot,
} from '@/lib/home-roster-snapshot';
import { Icon, type IconName } from './ui-icons';
import './report-home.css';

type SortMode = 'default' | 'popular' | 'added';
type ViewMode = 'grid' | 'list';
type ListSortKey = 'name' | 'code' | 'industry' | 'revenue' | 'net_profit' | 'eps' | 'yoy' | 'updatedAt' | 'status';
type ListSortDir = 'asc' | 'desc';

type VoicePickCandidate = ListedNameCode & { inPool: boolean };

type DialogState =
  | { kind: 'missing-company'; listed: { code: string; name: string }; query?: string; fromVoice?: boolean }
  | { kind: 'missing-report'; company: CrawlCompanyCoverage; period: ParsedPeriod; fromVoice?: boolean }
  | {
      kind: 'voice-confirm';
      listed: ListedNameCode;
      query: string;
      next: 'open' | 'ask' | 'join';
      period: ParsedPeriod;
      inPoolCompany?: CrawlCompanyCoverage | null;
    }
  | {
      kind: 'voice-pick';
      candidates: VoicePickCandidate[];
      query: string;
      hasQuestionIntent: boolean;
      period: ParsedPeriod;
    }
;

const VIEW_STORAGE_KEY = 'home_view_mode';
const STAR_STORAGE_KEY = 'home_starred_codes';

function deltaLabel(yoy: YoyResult | undefined) {
  return formatYoyBadge(yoy, 1);
}

function yoyClass(yoy: YoyResult | undefined) {
  const tone = yoyTone(yoy);
  if (tone === 'up') return 'rh-ashare-up';
  if (tone === 'down') return 'rh-ashare-down';
  return undefined;
}

function matchKeyword(item: CrawlCompanyCoverage, keyword: string) {
  return queryMatchesCompany(keyword, item);
}

function isConnected(item: CrawlCompanyCoverage) {
  return hasDownloadedPdf(item);
}

function statusMeta(item: CrawlCompanyCoverage) {
  if (hasReadableMetrics(item)) return '已接入';
  if (hasDownloadedPdf(item) && (item.parseStatus === 'failed' || item.parseError)) return '解析失败';
  if (hasDownloadedPdf(item) && item.parseStatus === 'parsing') return '已下载·解析中';
  if (hasDownloadedPdf(item) && item.parseStatus === 'queued') return '已下载·排队解析';
  if (hasDownloadedPdf(item)) return '已接入·待解析';
  if (item.parseStatus === 'failed') return '抓取失败';
  if (item.covered) return '已发现·待下载';
  return '等待抓取';
}

function coverageToPlaceholderSeeds(coverage: CrawlCompanyCoverage[]): PlaceholderSeed[] {
  return coverage
    .filter((item) => item.code && item.name)
    .map((item) => ({
      code: item.code,
      name: item.name,
      industryGroup: item.industryGroup,
      reportPeriod: item.reportPeriod,
      recentPeriods: item.recentPeriods,
      hasReadableMetrics: hasReadableMetrics(item),
    }));
}

function recentPeriodTokens(item: CrawlCompanyCoverage) {
  const tokens = [...(item.recentPeriods ?? []), item.reportPeriod].filter(Boolean) as string[];
  return pickRecentPeriods(tokens, 3);
}

function recentPeriodsLabel(item: CrawlCompanyCoverage) {
  return recentPeriodTokens(item).join(' | ');
}

function shortParseError(err: string | null | undefined) {
  if (!err) return '解析未完成，可在数据运营·采集页重试';
  const one = err.replace(/\s+/g, ' ').trim();
  return one.length > 72 ? `${one.slice(0, 72)}…` : one;
}

function metricByName(item: CrawlCompanyCoverage, name: string) {
  return item.metrics.find((m) => m.metric === name);
}

function metricResolvedYoy(metric: NonNullable<ReturnType<typeof metricByName>>) {
  return resolveYoy(metric.value, {
    disclosedPrior: metric.disclosedPrior,
    disclosedYoyPct: metric.disclosedYoyPct,
    crossReportPrior: metric.prior,
    metric: metric.metric,
  });
}

function metricYoyHoverTitle(metric: NonNullable<ReturnType<typeof metricByName>>) {
  return metricYoyHoverDetail(metric.metric, metric.value, {
    disclosedPrior: metric.disclosedPrior,
    disclosedYoyPct: metric.disclosedYoyPct,
    crossReportPrior: metric.prior,
  });
}

function primaryYoyMetric(item: CrawlCompanyCoverage) {
  const revenue = metricByName(item, 'revenue');
  if (revenue && metricResolvedYoy(revenue)) return revenue;
  const profit = metricByName(item, 'net_profit');
  if (profit && metricResolvedYoy(profit)) return profit;
  return undefined;
}

function primaryYoy(item: CrawlCompanyCoverage) {
  const metric = primaryYoyMetric(item);
  if (!metric) return undefined;
  const yoy = metricResolvedYoy(metric);
  if (yoy && !yoy.naPercent && yoy.pct !== undefined) return yoy.pct;
  return undefined;
}

function primaryYoyDesc(item: CrawlCompanyCoverage) {
  const metric = primaryYoyMetric(item);
  return metric ? metricResolvedYoy(metric) : undefined;
}

function readStoredView(): ViewMode {
  if (typeof window === 'undefined') return 'grid';
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return raw === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function readStarredCodes(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STAR_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is string => typeof c === 'string' && /^\d{6}$/.test(c));
  } catch {
    return [];
  }
}

function StarButton({
  code,
  starred,
  onToggle,
}: {
  code: string;
  starred: boolean;
  onToggle: (code: string) => void;
}) {
  return (
    <button
      type="button"
      className={`rh-star ${starred ? 'on' : ''}`}
      aria-pressed={starred}
      aria-label={starred ? '取消收藏' : '收藏'}
      title={starred ? '取消收藏' : '收藏'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(code);
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        {starred ? (
          <path
            fill="currentColor"
            d="M8 1.4l1.9 3.85 4.25.62-3.08 3 0.73 4.23L8 11.1l-3.8 2 0.73-4.23-3.08-3 4.25-.62L8 1.4z"
          />
        ) : (
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            d="M8 2.1l1.55 3.14 3.47.5-2.51 2.45.59 3.45L8 10.05l-3.1 1.63.59-3.45L3 5.74l3.47-.5L8 2.1z"
          />
        )}
      </svg>
    </button>
  );
}

export default function ReportHome() {
  const router = useRouter();
  const [coverage, setCoverage] = useState<CrawlCompanyCoverage[]>([]);
  const [stats, setStats] = useState<CrawlStats | null>(null);
  const [source, setSource] = useState<'postgresql' | 'crawl-mock' | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState<IndustryGroup | '全部'>('全部');
  const [sortMode, setSortMode] = useState<SortMode>('default');
  const [viewMode, setViewMode] = useState<ViewMode>(() => readStoredView());
  const [listSort, setListSort] = useState<{ key: ListSortKey; dir: ListSortDir } | null>(null);
  const [waitToast, setWaitToast] = useState<string | null>(null);
  /** Ephemeral home-AI reply (typed + voice); never seeds detail chat. */
  const [homeAnswer, setHomeAnswer] = useState<string | null>(null);
  const [voiceTurns, setVoiceTurns] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [starred, setStarred] = useState<string[]>(() => readStarredCodes());
  const [submitting, setSubmitting] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [crawlingCodes, setCrawlingCodes] = useState<string[]>([]);
  const [reportBusy, setReportBusy] = useState(false);
  /** Card grid: show 3 rows first, then reveal one-by-one as user scrolls. */
  const [visibleCardCount, setVisibleCardCount] = useState(9);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [placeholders, setPlaceholders] = useState<string[]>(DEFAULT_HOME_PLACEHOLDERS);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [personalizedQuestions, setPersonalizedQuestions] = useState<string[]>([]);
  const voice = useVoiceSession();
  const voiceDockRef = useVoiceFloatDrag(voice.active || Boolean(voice.toast));
  const voiceListening = voice.listening;
  const coverageRef = useRef(coverage);
  coverageRef.current = coverage;
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const onSearchSubmitRef = useRef<(override?: string, opts?: { fromPlaceholder?: boolean; fromVoice?: boolean; homeTurn?: HomeVoiceTurn }) => Promise<void>>(async () => undefined);
  const voiceNavigatingRef = useRef(false);
  const homeVoiceTurnsRef = useRef(new HomeVoiceTurns());
  const homeSpeakingTextRef = useRef('');
  const homeVoiceApiRef = useRef(voice);
  useLayoutEffect(() => { homeVoiceApiRef.current = voice; }, [voice]);
  const homeSpeakRef = useRef<(text: string) => Promise<void>>(async () => undefined);
  const homeMountedRef = useRef(false);
  const homeResumeTimersRef = useRef(new Set<number>());
  type VoiceConfirmDialog = Extract<DialogState, { kind: 'voice-confirm' }>;
  type VoicePickDialog = Extract<DialogState, { kind: 'voice-pick' }>;
  const voiceConfirmYesRef = useRef<(d: VoiceConfirmDialog) => Promise<void>>(async () => undefined);
  const voicePickRef = useRef<(d: VoicePickDialog, index: number) => Promise<void>>(async () => undefined);
  const closeBlockingDialogRef = useRef<(opts?: { resumeListen?: boolean }) => void>(() => undefined);
  const confirmMissingCompanyRef = useRef<() => Promise<void>>(async () => undefined);
  /** User typed/edited the super-entry while a voice session was active. */
  const searchEditedDuringVoiceRef = useRef(false);
  /** Mirrors dialog synchronously so utterance handler can hold while modal is open. */
  const dialogRef = useRef<DialogState | null>(null);

  const coveragePlaceholderKey = useMemo(
    () => coverage.map((item) => `${item.code}:${item.reportPeriod ?? ''}`).sort().join('|'),
    [coverage],
  );
  const [placeholderKey, setPlaceholderKey] = useState(coveragePlaceholderKey);
  if (coveragePlaceholderKey !== placeholderKey) {
    setPlaceholderKey(coveragePlaceholderKey);
    setPlaceholders(prependPersonalizedPlaceholders(
      personalizedQuestions,
      buildHomePlaceholders(coverageToPlaceholderSeeds(coverage)),
    ));
    setPlaceholderIndex(0);
  }

  const activePlaceholder = placeholders[placeholderIndex] ?? placeholders[0] ?? DEFAULT_HOME_PLACEHOLDERS[0];

  useEffect(() => {
    if (search.trim()) return;
    if (placeholders.length < 2) return;
    const timer = window.setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % placeholders.length);
    }, 4800);
    return () => window.clearInterval(timer);
  }, [search, placeholders]);


  // Home ASR lexicon: visible roster names + industries (客观清单，不做推荐).
  useEffect(() => {
    const extraTerms: string[] = [];
    for (const item of coverage) {
      if (item.name) extraTerms.push(item.name);
      if (item.industry) extraTerms.push(item.industry);
      if (item.industryGroup) extraTerms.push(String(item.industryGroup));
    }
    voice.setAsrCorrectContext({
      extraTerms,
    });
    return () => {
      voice.setAsrCorrectContext(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverage]);

  function clearHomeResumeTimers() {
    homeResumeTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    homeResumeTimersRef.current.clear();
  }

  function scheduleHomeResume(callback: () => void, delay: number) {
    const turn = homeVoiceTurnsRef.current.current;
    const timer = window.setTimeout(() => {
      homeResumeTimersRef.current.delete(timer);
      if (homeMountedRef.current && homeVoiceTurnsRef.current.owns(turn)) callback();
    }, delay);
    homeResumeTimersRef.current.add(timer);
  }

  function armHomeInterrupt(turn: HomeVoiceTurn | null) {
    if (!turn || !homeVoiceApiRef.current.active || turn.signal.aborted) return;
    homeVoiceApiRef.current.armBargeIn(() => {
      if (!homeVoiceTurnsRef.current.owns(turn)) return;
      homeVoiceTurnsRef.current.cancel(turn);
      homeSpeakingTextRef.current = '';
      setSubmitting(false);
      setDialogBusy(false);
      homeVoiceApiRef.current.setBusy(false);
      homeVoiceApiRef.current.setSpeaking(false);
    }, (text) => {
      const dialog = dialogRef.current;
      const replies = dialog?.kind === 'voice-pick'
        ? [...dialog.candidates.flatMap((c) => [c.name, c.code]), '第一个', '第二个', '第三个', '第四个', '第五个', '1', '2', '3', '4', '5', '取消']
        : dialog?.kind === 'voice-confirm' || dialog?.kind === 'missing-company'
          ? ['是', '好', '好的', '确定', '不是', '是的', '对', '不', '否', '行', '要', '不要', '可以', '加入', '取消', '不加入', '不用了'] : [];
      return acceptsHomeBargeSpeech(text, homeSpeakingTextRef.current, replies);
    });
  }

  function endHomeVoice() {
    setVoicePanelOpen(false);
    clearHomeResumeTimers();
    homeVoiceTurnsRef.current.cancel();
    homeSpeakingTextRef.current = '';
    voice.end();
  }

  async function speakHomeLine(line: string) {
    const turn = homeVoiceTurnsRef.current.current;
    assertHomeVoiceTurn(turn);
    homeSpeakingTextRef.current = line;
    homeVoiceApiRef.current.setBusy(true);
    homeVoiceApiRef.current.setSpeaking(true);
    armHomeInterrupt(turn);
    try {
      await speakAnswer(line, turn?.signal);
      assertHomeVoiceTurn(turn);
    } catch (error) {
      assertHomeVoiceTurn(turn);
      // Non-cancellation TTS failure should not break routing.
      if (error instanceof Error && error.name === 'AbortError') throw error;
    } finally {
      if (homeVoiceTurnsRef.current.owns(turn)) {
        homeSpeakingTextRef.current = '';
        homeVoiceApiRef.current.setSpeaking(false);
        homeVoiceApiRef.current.setBusy(false);
      }
    }
  }
  useLayoutEffect(() => { homeSpeakRef.current = speakHomeLine; });

  // Global voice session: register home routing; provider exclusively owns ASR.
  useEffect(() => {
    homeMountedRef.current = true;
    const turns = homeVoiceTurnsRef.current;
    const resumeTimers = homeResumeTimersRef.current;
    const pushTurn = (role: 'user' | 'assistant', content: string) => {
      appendHomeChatTurn(role, content);
      setVoiceTurns(getHomeChatTurns());
      if (shouldExpandHomeVoicePanel(role, content, homeVoiceApiRef.current.active)) setVoicePanelOpen(true);
    };
    const speakLine = async (line: string) => {
      const spoken = sanitizeHomeAssistantText(line) || line.trim();
      if (!spoken) return;
      pushTurn('assistant', spoken);
      await homeSpeakRef.current(spoken);
    };

    const route = async (text: string, turn: HomeVoiceTurn): Promise<VoiceUtteranceResult> => {
      const openDialog = dialogRef.current;

      // While a blocking dialog is open, only confirm/pick replies are accepted.
      if (openDialog?.kind === 'voice-confirm') {
        const reply = parseVoiceConfirmReply(text);
        if (reply === 'yes') {
          voice.setBusy(true);
          try {
            await voiceConfirmYesRef.current(openDialog);
          } finally {
            if (homeVoiceTurnsRef.current.owns(turn)) voice.setBusy(false);
          }
          return { action: 'hold' };
        }
        if (reply === 'no') {
          closeBlockingDialogRef.current({ resumeListen: true });
          setWaitToast('好的，请再说一次公司名或问题');
          return { action: 'hold' };
        }
        await speakLine('请说确定或不是');
        if (homeVoiceApiRef.current.active && dialogRef.current) voice.resumeListen();
        return { action: 'hold' };
      }
      if (openDialog?.kind === 'voice-pick') {
        const choice = parseVoicePickChoice(text, openDialog.candidates);
        if (choice?.kind === 'pick') {
          voice.setBusy(true);
          try {
            await voicePickRef.current(openDialog, choice.index);
          } finally {
            if (homeVoiceTurnsRef.current.owns(turn)) voice.setBusy(false);
          }
          return { action: 'hold' };
        }
        if (choice?.kind === 'cancel') {
          closeBlockingDialogRef.current({ resumeListen: true });
          return { action: 'hold' };
        }
        await speakLine('请说序号或公司名字');
        if (homeVoiceApiRef.current.active && dialogRef.current) voice.resumeListen();
        return { action: 'hold' };
      }
      if (openDialog?.kind === 'missing-company') {
        const reply = parseVoiceJoinReply(text);
        if (reply === 'yes') {
          voice.setBusy(true);
          try {
            await confirmMissingCompanyRef.current();
          } finally {
            if (homeVoiceTurnsRef.current.owns(turn)) voice.setBusy(false);
          }
          return { action: 'hold' };
        }
        if (reply === 'no') {
          closeBlockingDialogRef.current({ resumeListen: true });
          setWaitToast('好的，已取消加入');
          return { action: 'hold' };
        }
        await speakLine('请说加入或取消');
        if (homeVoiceApiRef.current.active && dialogRef.current) voice.resumeListen();
        return { action: 'hold' };
      }
      if (openDialog) {
        // missing-report (and any future blocking dialog): keep mic held
        return { action: 'hold' };
      }

      if (isVoiceFarewell(text)) {
        const line = pickVoiceFarewellLine();
        await speakLine(line);
        return { action: 'end' };
      }
      // Greetings: short product nudge. Pure filler (嗯/啊) stays silent.
      // 「你是谁 / 你能干啥 / 怎么问」and other chitchat go to home AI below.
      if (isVoiceGreetingOrNoise(text)) {
        const compact = text.replace(/\s+/g, '');
        const fillerOnly = /^(?:嗯+|啊+|呃+|额+|哦+|噢+|喔+|唉+|哎+|唔+|诶+|哈哈+|嘿嘿+|呵呵+)(?:啊|呀)?$/u.test(compact);
        if (fillerOnly) return { action: 'resume' };
      }
      // Route the completed utterance first; partial ASR never mutates the user's filter.
      searchEditedDuringVoiceRef.current = false;
      voice.setBusy(true);
      try {
        await onSearchSubmitRef.current(text, { fromVoice: true, homeTurn: turn });
      } finally {
        if (homeVoiceTurnsRef.current.owns(turn)) voice.setBusy(false);
      }
      if (voiceNavigatingRef.current || dialogRef.current) {
        // Detail handoff or blocking dialog — do not resume mic.
        return { action: 'hold' };
      }
      return { action: 'resume' };
    };
    const handler = async (text: string): Promise<VoiceUtteranceResult> => {
      if (isFeedbackDrawerOpen()) return { action: 'hold' };
      if (shouldExpandHomeVoicePanel('user', text, homeVoiceApiRef.current.active)) setVoicePanelOpen(true);
      const turn = homeVoiceTurnsRef.current.begin();
      homeSpeakingTextRef.current = '';
      try {
        const result = await route(text, turn);
        assertHomeVoiceTurn(turn);
        if (!homeVoiceApiRef.current.active || voiceNavigatingRef.current) return { action: 'hold' };
        if (result.action === 'end') homeVoiceApiRef.current.end();
        else if (result.action === 'resume') homeVoiceApiRef.current.resumeListen();
        return { action: 'hold' }; // This page now owns natural resume; stale provider handlers cannot.
      } catch (error) {
        if (turn.signal.aborted) return { action: 'hold' };
        throw error;
      }
    };
    voice.setUtteranceHandler(handler);
    return () => {
      // Abort only homepage work; keep the global session for the detail handoff.
      homeMountedRef.current = false;
      turns.cancel();
      resumeTimers.forEach((timer) => window.clearTimeout(timer));
      resumeTimers.clear();
      homeSpeakingTextRef.current = '';
      voice.stopMic();
      voice.setBusy(false);
      voice.setSpeaking(false);
      voice.setSuppressAutoListen(false);
      voice.setUtteranceHandler(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!voice.active) {
      homeVoiceTurnsRef.current.cancel();
      homeSpeakingTextRef.current = '';
      clearHomeResumeTimers();
      queueMicrotask(() => {
        if (homeMountedRef.current && !homeVoiceApiRef.current.active) {
          setSubmitting(false);
          setDialogBusy(false);
          setVoicePanelOpen(false);
        }
      });
    }
  }, [voice.active]);

  useEffect(() => subscribeFeedbackState((open) => {
    homeVoiceTurnsRef.current.cancel();
    clearHomeResumeTimers();
    const api = homeVoiceApiRef.current;
    api.stopMic(); api.setBusy(false); api.setSpeaking(false);
    api.setSuppressAutoListen(open);
    setSubmitting(false); setDialogBusy(false);
    if (open && api.active) {
      homeVoiceTurnsRef.current.begin();
      void homeSpeakRef.current(FEEDBACK_REVIEW_LINE).catch(() => undefined);
    } else if (!open && api.active) api.resumeListen();
  }), []);

  // If we landed on home while a session is already active (detail → 返回主页), resume listen.
  useEffect(() => {
    if (!voice.active) return;
    if (voice.listening || voice.speaking || voice.busy) return;
    const timer = window.setTimeout(() => {
      voice.resumeListen();
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detail → home: keep voice mic if active, but never inherit a report chat thread.
  // Home turns stay home-only; clearing on mount avoids a prior SPA visit leaking in.
  useEffect(() => {
    clearHomeChatTurns();
    setVoiceTurns([]);
    setSearch('');
    setHomeAnswer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Home owns the right-side dock; route errors there too, not a duplicate global toast.
  useLayoutEffect(() => {
    voice.setHideFloat(true);
    return () => voice.setHideFloat(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (voice.listening) searchEditedDuringVoiceRef.current = false;
  }, [voice.listening]);

  const refreshCoverage = useCallback(async (): Promise<CrawlCompanyCoverage[]> => {
    try {
      const response = await fetch('/api/crawl', { cache: 'no-store' });
      if (!response.ok) throw new Error(`抓取接口 ${response.status}`);
      const payload = await response.json() as {
        source?: 'postgresql' | 'crawl-mock';
        stats: CrawlStats;
        companies: CrawlCompanyCoverage[];
        warning?: string;
      };
      const companies = payload.companies ?? [];
      setCoverage(companies);
      setStats(payload.stats ?? null);
      setSource(payload.source ?? '');
      setError(payload.warning ?? (payload.source === 'crawl-mock' ? '当前展示为演示兜底数据（库为空或暂不可用）。' : ''));
      return companies;
    } catch (err) {
      setSource('');
      setError(`真实数据暂时无法读取：${String(err)}`);
      return coverageRef.current;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kick = window.setTimeout(() => { void refreshCoverage(); }, 0);
    const timer = window.setInterval(() => { void refreshCoverage(); }, 5 * 60 * 1000);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(timer);
    };
  }, [refreshCoverage]);

  useEffect(() => {
    if (!waitToast) return;
    const timer = window.setTimeout(() => setWaitToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [waitToast]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensureGuestCookie();
      try {
        const response = await fetch('/api/home/prompts', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok || cancelled) return;
        const payload = await response.json() as { questions?: string[] };
        const questions = Array.isArray(payload.questions)
          ? payload.questions.filter((q): q is string => typeof q === 'string' && Boolean(q.trim()))
          : [];
        if (!questions.length || cancelled) return;
        setPersonalizedQuestions(questions);
        const base = buildHomePlaceholders(coverageToPlaceholderSeeds(coverageRef.current));
        setPlaceholders(prependPersonalizedPlaceholders(questions, base));
        setPlaceholderIndex(0);
      } catch {
        /* guest mint / prompts optional for first paint */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, mode);
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const toggleStar = useCallback((code: string) => {
    setStarred((prev) => {
      const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code];
      try {
        window.localStorage.setItem(STAR_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const starredSet = useMemo(() => new Set(starred), [starred]);

  const parsedSearch = useMemo(() => parseHomeQuery(search), [search]);
  const recognizedListedCandidates = useMemo(() => {
    const raw = search.trim();
    if (!raw) return [] as ListedNameCode[];
    const primary = resolveListedCompanies(raw);
    if (primary.length) return primary;
    const cleaned = parsedSearch.companyQuery || raw;
    if (cleaned && cleaned !== raw) return resolveListedCompanies(cleaned);
    return [] as ListedNameCode[];
  }, [search, parsedSearch.companyQuery]);
  const recognizedListed = recognizedListedCandidates.length === 1 ? recognizedListedCandidates[0] : null;
  const recognizedListedCodes = useMemo(
    () => new Set(recognizedListedCandidates.map((c) => c.code)),
    [recognizedListedCandidates],
  );
  const keyword = search.trim();
  const ignoreCompanyFilter = shouldIgnoreHomeCompanyFilter(keyword);
  const filtered = useMemo(() => {
    let rows = coverage;
    if (!ignoreCompanyFilter && recognizedListedCandidates.length) {
      rows = coverage.filter((item) => recognizedListedCodes.has(item.code));
    } else if (keyword && !ignoreCompanyFilter) {
      rows = coverage.filter((item) => matchKeyword(item, parsedSearch.companyQuery || keyword));
      // Free-text questions without a resolvable company keep the full card grid.
      if (parsedSearch.hasQuestionIntent && !parsedSearch.companyQuery) rows = coverage;
    }
    if (industry !== '全部' && !recognizedListedCandidates.length) rows = rows.filter((item) => item.industryGroup === industry);
    rows = [...rows];

    if (listSort && viewMode === 'list') {
      const { key, dir } = listSort;
      const mul = dir === 'asc' ? 1 : -1;
      rows.sort((a, b) => {
        const av = (() => {
          if (key === 'name') return a.name;
          if (key === 'code') return a.code;
          if (key === 'industry') return a.industryGroup;
          if (key === 'revenue') return metricByName(a, 'revenue')?.value ?? -Infinity;
          if (key === 'net_profit') return metricByName(a, 'net_profit')?.value ?? -Infinity;
          if (key === 'eps') return metricByName(a, 'eps')?.value ?? -Infinity;
          if (key === 'yoy') return primaryYoy(a) ?? -Infinity;
          if (key === 'updatedAt') return a.lastCrawlAt ? new Date(a.lastCrawlAt).getTime() : 0;
          return statusMeta(a);
        })();
        const bv = (() => {
          if (key === 'name') return b.name;
          if (key === 'code') return b.code;
          if (key === 'industry') return b.industryGroup;
          if (key === 'revenue') return metricByName(b, 'revenue')?.value ?? -Infinity;
          if (key === 'net_profit') return metricByName(b, 'net_profit')?.value ?? -Infinity;
          if (key === 'eps') return metricByName(b, 'eps')?.value ?? -Infinity;
          if (key === 'yoy') return primaryYoy(b) ?? -Infinity;
          if (key === 'updatedAt') return b.lastCrawlAt ? new Date(b.lastCrawlAt).getTime() : 0;
          return statusMeta(b);
        })();
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
        return String(av).localeCompare(String(bv), 'zh-CN') * mul;
      });
    } else if (sortMode === 'popular') {
      rows.sort((a, b) => Number(hasReadableMetrics(b)) - Number(hasReadableMetrics(a)) || Number(isConnected(b)) - Number(isConnected(a)) || b.popularity - a.popularity || a.rank - b.rank);
    } else if (sortMode === 'added') {
      rows.sort((a, b) => {
        const at = a.addedAt ? new Date(a.addedAt).getTime() : 0;
        const bt = b.addedAt ? new Date(b.addedAt).getTime() : 0;
        return bt - at || a.rank - b.rank || a.code.localeCompare(b.code);
      });
    } else {
      rows.sort((a, b) => Number(hasReadableMetrics(b)) - Number(hasReadableMetrics(a)) || Number(isConnected(b)) - Number(isConnected(a)) || a.rank - b.rank || a.code.localeCompare(b.code));
    }

    // Starred companies first; keep relative order within each group.
    rows.sort((a, b) => Number(starredSet.has(b.code)) - Number(starredSet.has(a.code)));
    return rows;
  }, [coverage, keyword, ignoreCompanyFilter, industry, sortMode, listSort, viewMode, starredSet, recognizedListedCandidates, recognizedListedCodes, parsedSearch]);

  const gridCols = viewMode === 'list' ? 1 : 3;
  const initialRows = 3;
  const initialCards = gridCols * initialRows;
  const cardResetKey = `${initialCards}|${keyword}|${industry}|${sortMode}|${viewMode}|${listSort?.key ?? ''}|${listSort?.dir ?? ''}`;
  const [visibleForKey, setVisibleForKey] = useState(cardResetKey);
  if (cardResetKey !== visibleForKey) {
    setVisibleForKey(cardResetKey);
    setVisibleCardCount(initialCards);
  }

  const visibleCards = useMemo(
    () => (viewMode === 'list' ? filtered : filtered.slice(0, visibleCardCount)),
    [filtered, viewMode, visibleCardCount],
  );
  const hasMoreCards = viewMode !== 'list' && visibleCardCount < filtered.length;

  useEffect(() => {
    if (!hasMoreCards) return;
    const node = loadMoreRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setVisibleCardCount((n) => Math.min(filtered.length, n + 1));
      },
      { root: null, rootMargin: '200px 0px', threshold: 0 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMoreCards, filtered.length, visibleCardCount]);


  function cycleListSort(key: ListSortKey) {
    setListSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  function onEmptyCardActivate(e: MouseEvent | KeyboardEvent, item: CrawlCompanyCoverage) {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(hover: none), (max-width: 760px)').matches;
    if (!isMobile) return;
    e.preventDefault();
    setWaitToast(`${item.name}（${item.code}）：等待抓取`);
  }

  function openBlockingDialog(next: DialogState) {
    dialogRef.current = next;
    if (voice.active) {
      voice.stopMic();
      voice.setSuppressAutoListen(true);
    }
    setDialog(next);
  }

  function closeBlockingDialog(opts?: { resumeListen?: boolean }) {
    homeVoiceTurnsRef.current.cancel();
    homeSpeakingTextRef.current = '';
    const expectedTurn = homeVoiceTurnsRef.current.current;
    voice.stopMic();
    dialogRef.current = null;
    setDialog(null);
    voice.setSuppressAutoListen(false);
    const shouldResume = opts?.resumeListen !== false;
    if (shouldResume && voice.active && !voiceNavigatingRef.current) {
      scheduleHomeResume(() => {
        if (homeVoiceTurnsRef.current.current !== expectedTurn) return;
        if (homeVoiceApiRef.current.active && !dialogRef.current && !voiceNavigatingRef.current) {
          voice.resumeListen();
        }
      }, 200);
    }
  }
  closeBlockingDialogRef.current = closeBlockingDialog;

  async function speakBlockingPrompt(line: string) {
    await speakHomeLine(line);
  }

  /** After dialog TTS, reopen mic so user can answer while modal stays open. */
  function resumeDialogListen() {
    const turn = homeVoiceTurnsRef.current.current;
    if (!voice.active || voiceNavigatingRef.current) return;
    scheduleHomeResume(() => {
      if (!homeVoiceTurnsRef.current.owns(turn)) return;
      if (homeVoiceApiRef.current.active && dialogRef.current && !voiceNavigatingRef.current) {
        voice.resumeListen();
      }
    }, 120);
  }

  async function promptBlockingDialog(line: string) {
    const turn = homeVoiceTurnsRef.current.current;
    await speakBlockingPrompt(line);
    assertHomeVoiceTurn(turn);
    resumeDialogListen();
  }

  /** missing-company: align TTS + oral yes/no with on-screen 加入/取消. */
  async function openMissingCompanyDialog(opts: {
    listed: ListedNameCode;
    query?: string;
    fromVoice?: boolean;
  }) {
    const fromVoice = Boolean(opts.fromVoice);
    openBlockingDialog({
      kind: 'missing-company',
      listed: opts.listed,
      query: opts.query,
      fromVoice,
    });
    if (fromVoice && voice.active) {
      await promptBlockingDialog(buildVoiceJoinPrompt(opts.listed));
    }
  }

  /** After watch-pool join: carry original utterance into detail when possible. */
  async function afterJoinContinue(opts: {
    code: string;
    name: string;
    query?: string;
    fromVoice?: boolean;
    companies: CrawlCompanyCoverage[];
  }) {
    const q = (opts.query ?? '').trim();
    const company = opts.companies.find((c) => c.code === opts.code)
      ?? matchCompany(opts.code, opts.companies);
    voice.setSuppressAutoListen(false);
    if (!company) {
      setWaitToast(`已加入「${opts.name}」，请稍后再试`);
      if (opts.fromVoice && voice.active) {
        scheduleHomeResume(() => voice.resumeListen(), 200);
      }
      return;
    }
    if (q && hasQuestionIntent(q)) {
      await navigateWithAsk(company, q, parseHomeQuery(q).period, { fromVoice: opts.fromVoice });
      return;
    }
    if (opts.fromVoice || q) {
      if (opts.fromVoice && voice.active) {
        voiceNavigatingRef.current = true;
        voice.stopMic();
      }
      clearHomeChatTurns();
      router.push(`/${company.code}`);
      return;
    }
    if (voice.active) {
      scheduleHomeResume(() => voice.resumeListen(), 200);
    }
  }

    async function navigateWithAsk(company: CrawlCompanyCoverage, question: string, period: ParsedPeriod, opts?: { fromVoice?: boolean }) {
    const turn = homeVoiceTurnsRef.current.current;
    assertHomeVoiceTurn(turn);
    armHomeInterrupt(turn);
    const pre = coverageHasMatchingReport(company, period);
    let periodToken = period.token ?? null;
    let matched: Report | null = null;

    if (pre !== 'no') {
      try {
        const response = await fetch(`/api/reports?code=${encodeURIComponent(company.code)}&limit=100`, { cache: 'no-store', signal: turn?.signal });
        const payload = await readContractJson(response, parseReportListResponse);
        assertHomeVoiceTurn(turn);
        matched = pickBestReport(payload.reports, period);
        if (matched?.metrics?.[0]?.period) periodToken = matched.metrics[0].period;
        else if (period.token) periodToken = period.token;
      } catch {
        assertHomeVoiceTurn(turn);
        /* fall through — still navigate if coverage says yes */
      }
    }

    assertHomeVoiceTurn(turn);
    const periodSpecific = Boolean(period.year || period.kind || period.token || period.quarter);
    if (periodSpecific && !matched && pre !== 'yes') {
      openBlockingDialog({ kind: 'missing-report', company, period, fromVoice: Boolean(opts?.fromVoice) });
      return;
    }

    if (opts?.fromVoice && voice.active) {
      voiceNavigatingRef.current = true;
      voice.stopMic();
    }
    // Home ask → detail: isolate conversational context (fresh report thread).
    clearHomeChatTurns();
    markHomeAskHandoff(question);
    const url = buildCompanyAskUrl(company.code, question, periodToken);
    router.push(url);
  }

  function industryPeers(company: CrawlCompanyCoverage) {
    return coverage
      .filter((item) => item.code !== company.code
        && item.industryGroup
        && item.industryGroup === company.industryGroup
        && item.name)
      .slice(0, 6)
      .map((item) => ({ code: item.code, name: item.name }));
  }

  /** Fire-and-forget: only for typed active asks, persist personalized home prompts. */
  function rememberActiveAsk(question: string, company: CrawlCompanyCoverage) {
    void (async () => {
      try {
        await ensureGuestCookie();
        const response = await fetch('/api/home/prompts', {
          method: 'POST',
          credentials: 'same-origin',
          keepalive: true,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            question,
            companyCode: company.code,
            companyName: company.name,
            industryGroup: company.industryGroup,
            peers: industryPeers(company),
          }),
        });
        if (!response.ok) return;
        const payload = await response.json() as { questions?: string[] };
        const questions = Array.isArray(payload.questions)
          ? payload.questions.filter((q): q is string => typeof q === 'string' && Boolean(q.trim()))
          : [];
        if (!questions.length) return;
        setPersonalizedQuestions(questions);
      } catch {
        /* personalization must not block navigation */
      }
    })();
  }

  function pushTurn(role: 'user' | 'assistant', content: string) {
    appendHomeChatTurn(role, content);
    setVoiceTurns(getHomeChatTurns());
    if (shouldExpandHomeVoicePanel(role, content, homeVoiceApiRef.current.active)) setVoicePanelOpen(true);
  }

  async function deliverHomeAnswer(answer: string, opts?: { fromVoice?: boolean }) {
    assertHomeVoiceTurn(homeVoiceTurnsRef.current.current);
    const line = sanitizeHomeAssistantText(answer);
    if (!line) return;
    pushTurn('assistant', line);
    const shouldSpeak = Boolean(opts?.fromVoice || voice.active);
    if (!shouldSpeak) setHomeAnswer(line);
    if (!shouldSpeak) return;
    await speakHomeLine(line);
  }

  async function runHomeRosterAsk(raw: string, opts?: { fromVoice?: boolean }) {
    const turn = homeVoiceTurnsRef.current.current;
    assertHomeVoiceTurn(turn);
    homeSpeakingTextRef.current = '';
    armHomeInterrupt(turn);
    const pref = homeRosterSourcePreference(raw);
    const source = pref === 'pool'
      ? coverage
      : pref === 'filtered'
        ? filtered
        : (visibleCards.length ? visibleCards : filtered);
    const rows = buildHomeRosterRows(source, { starred: starredSet });
    const snapshot = formatHomeRosterSnapshot(rows, {
      visibleCount: visibleCards.length,
      filteredCount: filtered.length,
      poolCount: coverage.length,
      industry,
      viewMode,
    });
    pushTurn('user', raw);
    setHomeAnswer(null);

    const local = answerHomeRosterLocally(raw, rows);
    if (local?.openCode) {
      await deliverHomeAnswer(local.answer, opts);
      const hit = coverage.find((c) => c.code === local.openCode) ?? matchCompany(local.openCode, coverage);
      if (hit) {
        if (opts?.fromVoice && voice.active) {
          voiceNavigatingRef.current = true;
          voice.stopMic();
        }
        clearHomeChatTurns();
        router.push(`/${hit.code}`);
      }
      return;
    }
    if (local?.answer) {
      await deliverHomeAnswer(local.answer, opts);
      return;
    }

    try {
      const response = await fetch('/api/home/ask', {
        method: 'POST',
        signal: turn?.signal,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: raw,
          rosterSnapshot: snapshot,
          rows,
          history: getHomeChatTurns().slice(0, -1),
        }),
      });
      if (!response.ok) throw new Error(`home ask ${response.status}`);
      assertHomeVoiceTurn(turn);
      const payload = await response.json() as { answer?: string; openCode?: string | null };
      assertHomeVoiceTurn(turn);
      const answer = typeof payload.answer === 'string' ? payload.answer.trim() : '';
      if (!answer) throw new Error('empty home ask');
      await deliverHomeAnswer(answer, opts);
      const openCode = typeof payload.openCode === 'string' ? payload.openCode : '';
      if (openCode && /^\d{6}$/.test(openCode)) {
        const hit = coverage.find((c) => c.code === openCode);
        if (hit) {
          if (opts?.fromVoice && voice.active) {
            voiceNavigatingRef.current = true;
            voice.stopMic();
          }
          clearHomeChatTurns();
          router.push(`/${hit.code}`);
        }
      }
    } catch {
      assertHomeVoiceTurn(turn);
      await deliverHomeAnswer(
        rows.length
          ? `当前清单有 ${rows.length} 家。可以说「现在首页有哪些公司」，或点名打开一家；细问财报请进详情。`
          : '当前首页清单为空。稍后再问，或调整筛选。',
        opts,
      );
    }
  }

  async function runHomeChitchatAsk(raw: string, opts?: { fromVoice?: boolean }) {
    const turn = homeVoiceTurnsRef.current.current;
    assertHomeVoiceTurn(turn);
    homeSpeakingTextRef.current = '';
    armHomeInterrupt(turn);
    pushTurn('user', raw);
    if (!opts?.fromVoice) setSearch('');
    setHomeAnswer(null);
    // Local refuse for clear invest asks — no LLM needed.
    if (/买|卖|加仓|减仓|荐股|目标价|能不能买|该不该买|值得买/.test(raw)) {
      await deliverHomeAnswer(
        '我不做证券买卖建议。可以说公司名或六位代码，我帮你看已入库财报里的经营数据。',
        opts,
      );
      return;
    }
    try {
      const response = await fetch('/api/home/ask', {
        method: 'POST',
        signal: turn?.signal,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: raw,
          rosterSnapshot: HOME_CHITCHAT_SNAPSHOT_PLACEHOLDER,
          rows: [],
          history: getHomeChatTurns().slice(0, -1),
          mode: 'chitchat',
          spoken: Boolean(opts?.fromVoice || voice.active),
        }),
      });
      if (!response.ok) throw new Error(`home chitchat ${response.status}`);
      assertHomeVoiceTurn(turn);
      const payload = await response.json() as { answer?: string };
      assertHomeVoiceTurn(turn);
      const answer = typeof payload.answer === 'string' ? payload.answer.trim() : '';
      if (!answer) throw new Error('empty home chitchat');
      await deliverHomeAnswer(answer, opts);
    } catch {
      assertHomeVoiceTurn(turn);
      await deliverHomeAnswer(homeChitchatFallback(), opts);
    }
  }

    function buildVoicePickCandidates(listedRows: ListedNameCode[]): VoicePickCandidate[] {
    return listedRows.map((listed) => ({
      ...listed,
      inPool: coverage.some((c) => c.code === listed.code),
    }));
  }

  async function openVoicePickDialog(opts: {
    listedRows: ListedNameCode[];
    query: string;
    hasQuestionIntent: boolean;
    period: ParsedPeriod;
  }) {
    const candidates = buildVoicePickCandidates(opts.listedRows);
    openBlockingDialog({
      kind: 'voice-pick',
      candidates,
      query: opts.query,
      hasQuestionIntent: opts.hasQuestionIntent,
      period: opts.period,
    });
    await promptBlockingDialog(buildVoicePickPrompt(candidates));
  }

  async function maybeConfirmOrProceed(opts: {
    listed: ListedNameCode;
    raw: string;
    period: ParsedPeriod;
    fromVoice?: boolean;
    userEdited?: boolean;
    company: CrawlCompanyCoverage | null;
    isActiveTypedAsk: boolean;
  }) {
    const { listed, raw, period, fromVoice, userEdited, company, isActiveTypedAsk } = opts;
    if (
      needsVoiceCompanyConfirm({
        fromVoice,
        userEdited,
        query: raw,
        listed,
      })
    ) {
      const next = company ? (hasQuestionIntent(raw) ? 'ask' : 'open') : 'join';
      openBlockingDialog({
        kind: 'voice-confirm',
        listed,
        query: raw,
        next,
        period,
        inPoolCompany: company,
      });
      await promptBlockingDialog(buildVoiceConfirmPrompt(listed));
      return;
    }
    if (!company) {
      await openMissingCompanyDialog({
        listed,
        query: raw,
        fromVoice: Boolean(fromVoice),
      });
      return;
    }
    if (hasQuestionIntent(raw)) {
      if (isActiveTypedAsk) rememberActiveAsk(raw, company);
      await navigateWithAsk(company, raw, period, { fromVoice });
      return;
    }
    if (fromVoice && voice.active) {
      voiceNavigatingRef.current = true;
      voice.stopMic();
    }
    clearHomeChatTurns();
    router.push(`/${company.code}`);
  }

  async function onSearchSubmit(override?: string, opts?: { fromPlaceholder?: boolean; fromVoice?: boolean; homeTurn?: HomeVoiceTurn }) {
    if (!(override ?? search).trim() || (submitting && !opts?.fromVoice)) return;
    const turn = opts?.homeTurn ?? homeVoiceTurnsRef.current.begin();
    try {
      await submitHomeSearch(override, { ...opts, homeTurn: turn });
    } catch (error) {
      if (!turn.signal.aborted) throw error;
    } finally {
      if (!opts?.homeTurn && homeVoiceTurnsRef.current.owns(turn)
        && homeVoiceApiRef.current.active && !voiceNavigatingRef.current && !dialogRef.current) {
        homeVoiceApiRef.current.resumeListen();
      }
    }
  }

  async function submitHomeSearch(override?: string, opts?: { fromPlaceholder?: boolean; fromVoice?: boolean; homeTurn?: HomeVoiceTurn }) {
    const turn = opts?.homeTurn ?? homeVoiceTurnsRef.current.current;
    assertHomeVoiceTurn(turn);
    const raw = (override ?? search).trim();
    if (!raw || (submitting && !opts?.fromVoice)) return;
    if (isFeedbackDrawerOpen()) return;
    const compact = raw.replace(/\s+/g, '');
    if (isVoiceGreetingOrNoise(raw) && /^(?:嗯+|啊+|呃+|额+|哦+|噢+|喔+|唉+|哎+|唔+|诶+|哈哈+|嘿嘿+|呵呵+)(?:啊|呀)?$/u.test(compact)) return;
    setSubmitting(true);
    if (homeVoiceApiRef.current.active) homeVoiceApiRef.current.setBusy(true);
    armHomeInterrupt(turn);
    try {
      const semantic = await requestAssistantTurn({ question: raw, surface: 'home', history: getHomeChatTurns().slice(-8) }, turn?.signal ?? new AbortController().signal);
      assertHomeVoiceTurn(turn);
      if (semantic.kind !== 'domain') {
        pushTurn('user', raw);
        if (!opts?.fromVoice) setSearch('');
        if (semantic.kind === 'feedback') {
          pushTurn('assistant', FEEDBACK_REVIEW_LINE);
          requestFeedbackDraft(semantic.action, () => homeMountedRef.current && homeVoiceTurnsRef.current.owns(turn) && !isFeedbackDrawerOpen());
        } else await deliverHomeAnswer(semantic.answer, { fromVoice: opts?.fromVoice });
        return;
      }
    } finally {
      if (homeVoiceTurnsRef.current.owns(turn)) {
        setSubmitting(false);
        homeVoiceApiRef.current.setBusy(false);
      }
    }
    const fromVoice = Boolean(opts?.fromVoice);
    const userEdited = Boolean(fromVoice && searchEditedDuringVoiceRef.current);
    const commitMatchedVoiceSearch = (matchedCount: number) => {
      const next = matchedVoiceSearchText(raw, fromVoice, matchedCount);
      if (next !== null) setSearch(next);
    };
    if (isVoiceGreetingOrNoise(raw)) {
      const compact = raw.replace(/\s+/g, '');
      const fillerOnly = /^(?:嗯+|啊+|呃+|额+|哦+|噢+|喔+|唉+|哎+|唔+|诶+|哈哈+|嘿嘿+|呵呵+)(?:啊|呀)?$/u.test(compact);
      if (!fromVoice) setSearch('');
      if (fillerOnly) return;
      setSubmitting(true);
      try {
        await runHomeChitchatAsk(raw, { fromVoice });
      } finally {
        if (homeVoiceTurnsRef.current.owns(turn)) setSubmitting(false);
      }
      return;
    }
    // Identity, capability, how-to-ask, and other non-company chat. Do not filter the grid.
    if (isHomeChitchatUtterance(raw)) {
      if (!fromVoice) setSearch('');
      setSubmitting(true);
      try {
        await runHomeChitchatAsk(raw, { fromVoice });
      } finally {
        if (homeVoiceTurnsRef.current.owns(turn)) setSubmitting(false);
      }
      return;
    }
    const parsed = parseHomeQuery(raw);
    const isActiveTypedAsk = Boolean(parsed.hasQuestionIntent && !opts?.fromPlaceholder && search.trim());
    const handoffVoice = Boolean(fromVoice && voice.active);
    const goCompany = (code: string) => {
      if (handoffVoice) {
        voiceNavigatingRef.current = true;
        voice.stopMic(); // keep session; detail handler will resume
      }
      // Leaving home for a company: drop home-only turns (detail has its own thread).
      clearHomeChatTurns();
      router.push(`/${code}`);
    };

    // Home roster / homepage-context asks: inject visible list into home AI (typed+voice).
    // Keep isolation — never hand these turns to company-detail chat.
    if (isHomeRosterQuestion(raw)) {
      setSubmitting(true);
      try {
        await runHomeRosterAsk(raw, { fromVoice });
      } finally {
        if (homeVoiceTurnsRef.current.owns(turn)) setSubmitting(false);
      }
      return;
    }

    // Pure 6-digit code without question → open, join if listed, or offer code-join dialog
    if (/^\d{6}$/.test(raw) && !parsed.hasQuestionIntent) {
      const hit = matchCompany(raw, coverage);
      if (hit) {
        commitMatchedVoiceSearch(1);
        goCompany(hit.code);
        return;
      }
      const listed = resolveListedCompany(raw);
      if (listed) {
        commitMatchedVoiceSearch(1);
        await openMissingCompanyDialog({ listed, query: raw, fromVoice });
        return;
      }
      // 名录外无效六位码：与短串一致，滚到公司区空态（不弹阻塞框）
      document.getElementById('rh-companies')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    // Short name/code filter-only: open company, or offer to join monitor pool if only in 全量识别名录.
    if (!parsed.hasQuestionIntent) {
      const poolHits = matchCompanies(parsed.companyQuery || raw, coverage);
      const poolHitsRaw = poolHits.length ? poolHits : matchCompanies(raw, coverage);
      if (poolHitsRaw.length) commitMatchedVoiceSearch(poolHitsRaw.length);
      if (poolHitsRaw.length === 1) {
        await maybeConfirmOrProceed({
          listed: { code: poolHitsRaw[0].code, name: poolHitsRaw[0].name },
          raw,
          period: parsed.period,
          fromVoice,
          userEdited,
          company: poolHitsRaw[0],
          isActiveTypedAsk: false,
        });
        return;
      }
      if (poolHitsRaw.length > 1) {
        if (fromVoice) {
          await openVoicePickDialog({
            listedRows: poolHitsRaw.map((c) => ({ code: c.code, name: c.name })),
            query: raw,
            hasQuestionIntent: false,
            period: parsed.period,
          });
          return;
        }
        document.getElementById('rh-companies')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const listedAll = resolveListedCompanies(raw);
      const listedFallback = listedAll.length ? listedAll : resolveListedCompanies(parsed.companyQuery || raw);
      if (listedFallback.length) commitMatchedVoiceSearch(listedFallback.length);
      if (listedFallback.length === 1) {
        await maybeConfirmOrProceed({
          listed: listedFallback[0],
          raw,
          period: parsed.period,
          fromVoice,
          userEdited,
          company: null,
          isActiveTypedAsk: false,
        });
        return;
      }
      if (listedFallback.length > 1) {
        if (fromVoice) {
          await openVoicePickDialog({
            listedRows: listedFallback,
            query: raw,
            hasQuestionIntent: false,
            period: parsed.period,
          });
          return;
        }
        // Ambiguous: keep empty-state candidate list visible for click-to-join.
        document.getElementById('rh-companies')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // 0 hits: company-like short filter stays empty; clear chitchat (笑话/天气…) may answer.
      if (fromVoice && isLikelyHomeChitchat(raw)) {
        setSubmitting(true);
        try {
          await runHomeChitchatAsk(raw, { fromVoice: true });
        } finally {
          if (homeVoiceTurnsRef.current.owns(turn)) setSubmitting(false);
        }
        return;
      }
      document.getElementById('rh-companies')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    setSubmitting(true);
    try {
      // 1) Recognize listed company from A-share table (precise name/code, not AI)
      const listedAll = resolveListedCompanies(raw);
      const listedCandidates = listedAll.length ? listedAll : resolveListedCompanies(parsed.companyQuery || raw);
      if (!listedCandidates.length) {
        // 像在问公司但名录 0：滚空态，不装懂。无公司实体闲聊 → 受控短答 AI。
        if (looksLikeUnresolvedCompanyAsk(raw)) {
          document.getElementById('rh-companies')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        if (isLikelyHomeChitchat(raw) || fromVoice) {
          await runHomeChitchatAsk(raw, { fromVoice });
          return;
        }
        document.getElementById('rh-companies')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      commitMatchedVoiceSearch(listedCandidates.length);
      if (listedCandidates.length > 1) {
        if (fromVoice) {
          // 「东鹏最近业绩好不好」→ never silent preferred; keep full utterance for later ask.
          await openVoicePickDialog({
            listedRows: listedCandidates,
            query: raw,
            hasQuestionIntent: true,
            period: parsed.period,
          });
          return;
        }
        const inPool = listedCandidates
          .map((listed) => coverage.find((c) => c.code === listed.code))
          .filter((c): c is CrawlCompanyCoverage => Boolean(c));
        if (inPool.length >= 1) {
          // Typed compare / multi-name: keep previous preferred-in-pool behavior.
          const preferred = [...inPool].sort((a, b) => {
            const ai = Math.min(
              ...[a.name, a.code].map((token) => {
                const i = raw.indexOf(token);
                return i < 0 ? Number.POSITIVE_INFINITY : i;
              }),
            );
            const bi = Math.min(
              ...[b.name, b.code].map((token) => {
                const i = raw.indexOf(token);
                return i < 0 ? Number.POSITIVE_INFINITY : i;
              }),
            );
            return ai - bi || a.code.localeCompare(b.code);
          })[0] ?? inPool[0];
          if (isActiveTypedAsk) rememberActiveAsk(raw, preferred);
          await navigateWithAsk(preferred, raw, parsed.period, { fromVoice });
          return;
        }
        await openMissingCompanyDialog({
          listed: listedCandidates[0],
          query: raw,
          fromVoice: false,
        });
        return;
      }
      const listed = listedCandidates[0];
      // 2) Check whether it is in the active 60-company monitor pool
      const company = coverage.find((c) => c.code === listed.code)
        ?? matchCompany(listed.code, coverage)
        ?? matchCompany(listed.name, coverage)
        ?? null;
      await maybeConfirmOrProceed({
        listed,
        raw,
        period: parsed.period,
        fromVoice,
        userEdited,
        company,
        isActiveTypedAsk,
      });
    } finally {
      if (homeVoiceTurnsRef.current.owns(turn)) setSubmitting(false);
    }
  }

  onSearchSubmitRef.current = onSearchSubmit;

  async function resolveVoiceConfirmYes(d: VoiceConfirmDialog) {
    const listed = d.listed;
    if (d.next === 'join' || !d.inPoolCompany) {
      await openMissingCompanyDialog({
        listed,
        query: d.query,
        fromVoice: true,
      });
      return;
    }
    dialogRef.current = null;
    setDialog(null);
    voice.setSuppressAutoListen(false);
    if (d.next === 'ask') {
      await navigateWithAsk(d.inPoolCompany, d.query, d.period, { fromVoice: true });
      return;
    }
    voiceNavigatingRef.current = true;
    voice.stopMic();
    clearHomeChatTurns();
    router.push(`/${d.inPoolCompany.code}`);
  }
  voiceConfirmYesRef.current = resolveVoiceConfirmYes;

  async function resolveVoicePick(d: VoicePickDialog, index: number) {
    const listed = d.candidates[index];
    if (!listed) return;
    const company = coverage.find((c) => c.code === listed.code)
      ?? matchCompany(listed.code, coverage);
    if (company) {
      dialogRef.current = null;
      setDialog(null);
      voice.setSuppressAutoListen(false);
      if (d.hasQuestionIntent) {
        await navigateWithAsk(company, d.query, d.period, { fromVoice: true });
      } else {
        voiceNavigatingRef.current = true;
        voice.stopMic();
        clearHomeChatTurns();
        router.push(`/${company.code}`);
      }
      return;
    }
    // Not in pool — keep original utterance for after-join continue + join TTS.
    await openMissingCompanyDialog({
      listed: { code: listed.code, name: listed.name },
      query: d.query,
      fromVoice: true,
    });
  }
  voicePickRef.current = resolveVoicePick;


  async function confirmMissingCompany() {
    if (!dialog || dialog.kind !== 'missing-company' || dialogBusy) return;
    const turn = homeVoiceTurnsRef.current.current;
    assertHomeVoiceTurn(turn);
    const { listed, query, fromVoice } = dialog;
    setDialogBusy(true);
    try {
      const response = await fetch('/api/companies/watch', {
        method: 'POST',
        signal: turn?.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: listed.code, name: listed.name }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        note?: string;
        enabledCount?: number;
      };
      assertHomeVoiceTurn(turn);
      if (!response.ok) {
        setWaitToast(payload.error ?? '加入监控池失败，请稍后重试');
        return;
      }
      setWaitToast(payload.note ?? `已将「${listed.name}」加入监控池`);
      dialogRef.current = null;
      setDialog(null);
      const companies = await refreshCoverage();
      assertHomeVoiceTurn(turn);
      await afterJoinContinue({
        code: listed.code,
        name: listed.name,
        query,
        fromVoice,
        companies,
      });
    } finally {
      if (homeVoiceTurnsRef.current.owns(turn)) setDialogBusy(false);
    }
  }
  confirmMissingCompanyRef.current = confirmMissingCompany;

  async function confirmMissingReport() {
    if (!dialog || dialog.kind !== 'missing-report') return;
    const { company } = dialog;
    setDialogBusy(true);
    try {
      const response = await fetch('/api/crawl/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'backlog', codes: [company.code] }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        note?: string;
        downloaded?: number;
        parsed?: number;
        paused?: boolean;
      };
      if (!response.ok) {
        setWaitToast(payload.error ?? '采集触发失败，请稍后在「数据运营」重试');
        closeBlockingDialog({ resumeListen: true });
        return;
      }
      setWaitToast(
        payload.note
          ?? `已为 ${company.name}（${company.code}）触发温和采集：下载 ${payload.downloaded ?? 0} · 解析 ${payload.parsed ?? 0}`,
      );
      closeBlockingDialog({ resumeListen: true });
    } catch (err) {
      setWaitToast(`网络异常：${String(err)}`);
      closeBlockingDialog({ resumeListen: true });
    } finally {
      setDialogBusy(false);
    }
  }

  async function triggerHomeCrawl(item: CrawlCompanyCoverage, e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (crawlingCodes.includes(item.code)) {
      router.push(`/admin/sources?focus=${encodeURIComponent(item.code)}`);
      return;
    }
    setCrawlingCodes((prev) => (prev.includes(item.code) ? prev : [...prev, item.code]));
    setWaitToast(`${item.name}（${item.code}）：正在发现并下载财报…`);
    try {
      const response = await fetch('/api/crawl/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'backlog', codes: [item.code] }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; note?: string; paused?: boolean };
      if (!response.ok) {
        setCrawlingCodes((prev) => prev.filter((c) => c !== item.code));
        setWaitToast(payload.error ?? '立即抓取失败，请在数据源页确认自动抓取已开启');
        return;
      }
      setWaitToast(payload.note ?? `${item.name}：已进入抓取队列`);
    } catch (err) {
      setCrawlingCodes((prev) => prev.filter((c) => c !== item.code));
      setWaitToast(`网络异常：${String(err)}`);
      return;
    }
    router.push(`/admin/sources?focus=${encodeURIComponent(item.code)}`);
  }

  /** Empty-state light entry: report current search for admin roster backfill (no blocking dialog). */
  async function reportCurrentSearchMissing() {
    const query = search.trim();
    if (!query || reportBusy) return;
    setReportBusy(true);
    try {
      const response = await fetch('/api/companies/report-missing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; note?: string };
      if (!response.ok) {
        setWaitToast(payload.error ?? '上报失败，请稍后重试');
        return;
      }
      setWaitToast(payload.note ?? '已上报给管理员');
    } catch (err) {
      setWaitToast(`网络异常：${String(err)}`);
    } finally {
      setReportBusy(false);
    }
  }

  const listedOutsidePoolCandidates = ignoreCompanyFilter
    ? []
    : recognizedListedCandidates.filter(
      (listed) => !coverage.some((item) => item.code === listed.code),
    );
  const listedOutsidePool = listedOutsidePoolCandidates.length === 1
    ? listedOutsidePoolCandidates[0]
    : null;

  return (
    <section className="rh-home">
      <header className="rh-intro">
        <h1>财报智析 Eva</h1>
        <p className="rh-intro-sub">问财报，有出处</p>
      </header>

      <form
        className="rh-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (submitting) return;
          const typed = search.trim();
          // Unrelated saved search is not the live utterance. Explicit edits still win.
          if (voiceListening) {
            if (searchEditedDuringVoiceRef.current) voice.setPartial(typed);
            voice.finalizeListen({ userInitiated: true });
            return;
          }
          if (!typed) return;
          if (voice.active && searchEditedDuringVoiceRef.current) {
            searchEditedDuringVoiceRef.current = false;
            voice.setSuppressAutoListen(false);
            void onSearchSubmit(typed, { fromVoice: true });
            return;
          }
          void onSearchSubmit(typed);
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5" />
        </svg>
        <input
          ref={searchInputRef}
          aria-label="搜索或提问：公司名称、股票代码，或自然语言问题"
          placeholder={voiceListening ? '语音输入中…' : activePlaceholder}
          value={search}
          onChange={(e) => {
            const v = e.target.value;
            setSearch(v);
            if (!voice.active && !voiceListening) return;
            searchEditedDuringVoiceRef.current = true;
            voice.setPartial(v);
            // Pause mic so ASR partials do not fight keyboard edits; keep session.
            if (voiceListening) {
              voice.setSuppressAutoListen(true);
              voice.stopMic();
            }
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
            if (search.trim() || voiceListening || submitting) return;
            const q = activePlaceholder?.trim();
            if (!q) return;
            e.preventDefault();
            setSearch(q);
            window.requestAnimationFrame(() => {
              const el = searchInputRef.current;
              if (!el) return;
              el.focus();
              const end = q.length;
              el.setSelectionRange(end, end);
            });
          }}
          disabled={submitting}
        />
        {search ? (
          <button
            className="rh-clear"
            type="button"
            aria-label="清空搜索"
            onClick={() => {
              setSearch('');
              if (voice.active || voiceListening) {
                searchEditedDuringVoiceRef.current = true;
                voice.setPartial('');
                if (voiceListening) {
                  voice.setSuppressAutoListen(true);
                  voice.stopMic();
                }
              }
            }}
          >
            <Icon name="x" size={16} />
          </button>
        ) : null}
        {(() => {
          const stopGlyph = (
            <svg className="rh-search-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
            </svg>
          );
          const sendGlyph = (
            <svg className="rh-search-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M12 4l7 7h-4v9H9v-9H5z" />
            </svg>
          );
          const waveGlyph = (
            <svg className="rh-search-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <rect x="4" y="9" width="2.2" height="6" rx="1.1" fill="currentColor" />
              <rect x="8.2" y="6" width="2.2" height="12" rx="1.1" fill="currentColor" />
              <rect x="12.4" y="3.5" width="2.2" height="17" rx="1.1" fill="currentColor" />
              <rect x="16.6" y="6" width="2.2" height="12" rx="1.1" fill="currentColor" />
              <rect x="20.8" y="9" width="2.2" height="6" rx="1.1" fill="currentColor" />
            </svg>
          );
          if (submitting) {
            return (
              <button className="rh-search-submit rh-search-stop" type="button" disabled aria-label="提交中" title="提交中">
                <span className="rh-search-spinner" aria-hidden="true" />
              </button>
            );
          }
          if (voice.arming) {
            return (
              <button
                className="rh-search-submit rh-search-cancel"
                type="button"
                aria-label="取消发送"
                title="取消发送"
                onClick={() => {
                  searchEditedDuringVoiceRef.current = false;
                  voice.cancelArmedSend();
                }}
              >
                取消
              </button>
            );
          }
          if (voiceListening) {
            const pendingText = homeVoiceFinalizeText(voice.partial, search, searchEditedDuringVoiceRef.current);
            const hasText = Boolean(pendingText);
            const stopLabel = hasText ? '结束并发送' : '结束语音';
            return (
              <button
                className="rh-search-submit rh-search-stop"
                type="button"
                aria-label={stopLabel}
                title={stopLabel}
                onClick={() => {
                  // Mirror detail: empty → quiet end; has text → flush & send.
                  if (!hasText) {
                    endHomeVoice();
                    return;
                  }
                  if (searchEditedDuringVoiceRef.current) voice.setPartial(pendingText);
                  voice.finalizeListen({ userInitiated: true });
                }}
              >
                {stopGlyph}
              </button>
            );
          }
          if (search.trim()) {
            return (
              <button
                className="rh-search-submit rh-search-send"
                type="submit"
                aria-label="搜索"
                title="搜索"
              >
                {sendGlyph}
              </button>
            );
          }
          return (
            <button
              className="rh-search-submit rh-search-voice"
              type="button"
              aria-label="语音提问"
              title="语音提问"
              onClick={() => {
                setVoicePanelOpen(false); // A fresh session never unfolds old history.
                searchEditedDuringVoiceRef.current = false;
                voice.setSuppressAutoListen(false);
                void voice.start();
              }}
            >
              {waveGlyph}
            </button>
          );
        })()}
      </form>
      {voice.arming ? (
        <p className="rh-search-hint" role="status">即将发送</p>
      ) : voiceListening ? (
        /* Placeholder already says 语音输入中… — keep spacer so layout doesn't jump. */
        <p className="rh-search-hint rh-search-hint-spacer" aria-hidden="true" />
      ) : voice.active ? (
        <p className="rh-search-hint" role="status">语音会话中</p>
      ) : (
        <p className="rh-search-hint rh-search-hint-spacer" aria-hidden="true" />
      )}

      {homeAnswer && !voice.active && (
        <div className="rh-home-answer" role="status" aria-live="polite">
          <div className="rh-home-answer-label">Eva</div>
          <p>{homeAnswer}</p>
          <button
            type="button"
            className="rh-home-answer-dismiss"
            aria-label="关闭回答"
            onClick={() => setHomeAnswer(null)}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {source === 'crawl-mock' && (
        <div className="rh-mock-banner" role="status">
          ⚠️ 实时数据暂时不可用，当前为示例数据
          {error ? <span>{error}</span> : null}
        </div>
      )}
      {error && source !== 'crawl-mock' && (
        <div className="rh-error" role="alert">
          {error}
        </div>
      )}

      <section className="rh-companies" id="rh-companies" aria-labelledby="rh-list-title">
        <div className="rh-filters" aria-label="筛选与排序">
          <div className="rh-filter-bar">
            <div className="rh-chip-row" role="radiogroup" aria-label="行业筛选">
              <button
                type="button"
                role="radio"
                aria-checked={industry === '全部'}
                className={industry === '全部' ? 'rh-chip active' : 'rh-chip'}
                onClick={() => setIndustry('全部')}
              >
                全部
              </button>
              {INDUSTRY_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  role="radio"
                  aria-checked={industry === chip}
                  className={industry === chip ? 'rh-chip active' : 'rh-chip'}
                  onClick={() => setIndustry(chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
            <div className="rh-toolbar-right">
              <label className="rh-sort">
                <span>排序</span>
                <select
                  value={sortMode}
                  onChange={(e) => {
                    setSortMode(e.target.value as SortMode);
                    setListSort(null);
                  }}
                  aria-label="排序方式"
                >
                  <option value="default">默认</option>
                  <option value="popular">热门</option>
                  <option value="added">添加时间</option>
                </select>
              </label>
              <div className="rh-view-toggle" role="group" aria-label="视图切换">
                <button
                  type="button"
                  className={viewMode === 'grid' ? 'rh-view-btn active' : 'rh-view-btn'}
                  aria-label="网格视图"
                  aria-pressed={viewMode === 'grid'}
                  onClick={() => setView('grid')}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <rect x="1" y="1" width="6" height="6" rx="1" />
                    <rect x="9" y="1" width="6" height="6" rx="1" />
                    <rect x="1" y="9" width="6" height="6" rx="1" />
                    <rect x="9" y="9" width="6" height="6" rx="1" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={viewMode === 'list' ? 'rh-view-btn active' : 'rh-view-btn'}
                  aria-label="列表视图"
                  aria-pressed={viewMode === 'list'}
                  onClick={() => setView('list')}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <rect x="1" y="2" width="14" height="2" rx="0.5" />
                    <rect x="1" y="7" width="14" height="2" rx="0.5" />
                    <rect x="1" y="12" width="14" height="2" rx="0.5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="rh-card-grid rh-card-grid-all" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rh-skeleton-card">
                <div className="rh-skel rh-skel-title" />
                <div className="rh-skel rh-skel-line" />
                <div className="rh-skel rh-skel-metrics" />
              </div>
            ))}
          </div>
        ) : viewMode === 'list' ? (
          <div className="rh-table-wrap">
            <table className="rh-table">
              <thead>
                <tr>
                  <th scope="col" className="rh-th-star">
                    <span className="sr-only">收藏</span>
                  </th>
                  {(
                    [
                      ['name', '名称'],
                      ['code', '代码'],
                      ['industry', '行业'],
                      ['revenue', '营收'],
                      ['net_profit', '净利润'],
                      ['eps', 'EPS'],
                      ['yoy', '同比'],
                      ['updatedAt', '更新'],
                      ['status', '状态'],
                    ] as Array<[ListSortKey, string]>
                  ).map(([key, label]) => {
                    const active = listSort?.key === key;
                    const arrow: IconName = !active ? 'sort' : listSort?.dir === 'asc' ? 'arrowUp' : 'arrowDown';
                    return (
                      <th key={key} scope="col">
                        <button
                          type="button"
                          className={`rh-th-sort ${active ? 'active' : ''}`}
                          onClick={() => cycleListSort(key)}
                          aria-label={`${label}排序`}
                        >
                          {label}
                          <Icon name={arrow} size={12} />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const connected = isConnected(item);
                  const revenue = metricByName(item, 'revenue');
                  const profit = metricByName(item, 'net_profit');
                  const eps = metricByName(item, 'eps');
                  const isStarred = starredSet.has(item.code);
                  return (
                    <tr key={item.code} className={connected ? '' : 'rh-row-empty'}>
                      <td className="rh-td-star">
                        <StarButton code={item.code} starred={isStarred} onToggle={toggleStar} />
                      </td>
                      <td>
                        <Link href={`/${item.code}`} className="rh-table-name">
                          {item.name}
                        </Link>
                      </td>
                      <td>
                        <span className="rh-code-with-star">
                          {item.code}
                        </span>
                      </td>
                      <td>{item.industryGroup}</td>
                      <td>{revenue ? formatMetricValue('revenue', revenue.value) : '—'}</td>
                      <td>{profit ? formatMetricValue('net_profit', profit.value) : '—'}</td>
                      <td>{eps ? formatMetricValue('eps', eps.value) : '—'}</td>
                      <td>
                        {(() => {
                          const metric = primaryYoyMetric(item);
                          if (!metric) return '—';
                          const desc = metricResolvedYoy(metric);
                          if (!desc) return '—';
                          const cls = yoyClass(desc);
                          const hover = metricYoyHoverTitle(metric);
                          return cls ? (
                            <span className={cls} title={hover}>{deltaLabel(desc)}</span>
                          ) : (
                            <span title={hover}>{deltaLabel(desc)}</span>
                          );
                        })()}
                      </td>
                      <td>{freshnessLabel(item.lastCrawlAt)}</td>
                      <td>{statusMeta(item)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rh-card-grid rh-card-grid-all">
            {visibleCards.map((item) => {
              const downloaded = isConnected(item);
              const readable = hasReadableMetrics(item);
              const isStarred = starredSet.has(item.code);
              const isCrawling = crawlingCodes.includes(item.code);
              if (!downloaded) {
                return (
                  <div
                    key={item.code}
                    className={`rh-company-card rh-company-card-empty ${isCrawling ? 'rh-crawling' : ''}`}
                  >
                    {isCrawling ? (
                      <span className="rh-crawling-badge" title="抓取中">抓取中</span>
                    ) : (
                      <button
                        type="button"
                        className="rh-crawl-now-btn"
                        aria-label={`立即抓取 ${item.name}`}
                        title="立即抓取"
                        onClick={(e) => void triggerHomeCrawl(item, e)}
                      >
                        立即抓取
                      </button>
                    )}
                    <Link
                      href={`/${item.code}`}
                      className="rh-empty-card-link"
                      aria-label={`${item.name} ${item.code}，等待抓取`}
                      title="等待抓取"
                      onClick={(e) => onEmptyCardActivate(e, item)}
                    >
                      <div className="rh-empty-card-body">
                        <h3>
                          {item.name}
                          <small className="rh-code-with-star">
                            {item.code}
                            <StarButton code={item.code} starred={isStarred} onToggle={toggleStar} />
                          </small>
                        </h3>
                      </div>
                      <div className="rh-card-meta">{isCrawling ? '抓取中' : '等待抓取'}</div>
                    </Link>
                  </div>
                );
              }

              const previewMetrics = item.metrics.slice(0, 3);
              const periodTokens = recentPeriodTokens(item);
              const displayPeriod = item.reportPeriod || periodTokens[0] || null;
              const freshIso = freshnessAt(item);
              const parseFailed = !readable && (item.parseStatus === 'failed' || Boolean(item.parseError));
              const cardState = readable ? '' : parseFailed ? ' rh-company-card-failed' : ' rh-company-card-parsing';
              return (
                <div
                  key={item.code}
                  className={`rh-company-card rh-company-card-connected${cardState}`}
                >
                  {parseFailed ? (
                    <Link
                      href={`/admin/sources?focus=${item.code}`}
                      className="rh-connected-badge rh-connected-badge-failed"
                      title="打开数据运营·采集处理解析失败"
                      onClick={(e) => e.stopPropagation()}
                    >
                      解析失败
                    </Link>
                  ) : (
                    <span className="rh-connected-badge" title="财报 PDF 已下载">
                      已接入
                    </span>
                  )}
                  <Link
                    href={`/${item.code}`}
                    className="rh-card-main"
                    aria-label={
                      readable
                        ? `查看${item.name}财报`
                        : parseFailed
                          ? `${item.name}财报解析失败`
                          : `${item.name}财报已下载，指标解析中`
                    }
                  >
                    <div className="rh-card-top">
                      <div>
                        <h3>
                          {item.name}
                          <small className="rh-code-with-star">
                            {item.code}
                            <StarButton code={item.code} starred={isStarred} onToggle={toggleStar} />
                          </small>
                        </h3>
                        <p>
                          <span className="rh-industry-badge">{item.industryGroup}</span>
                          {item.theme ? <span>{item.theme}</span> : null}
                        </p>
                      </div>
                    </div>
                    <div className="rh-card-metrics rh-card-metrics-3">
                      {!readable ? (
                        <div className="rh-metric-empty">
                          <span>指标</span>
                          <strong>{parseFailed ? '解析失败' : '解析中'}</strong>
                          <small>{parseFailed ? shortParseError(item.parseError) : 'PDF 已下载，核心指标尚未就绪'}</small>
                        </div>
                      ) : null}
                      {previewMetrics.map((metric) => {
                        const yoy = resolveYoy(metric.value, {
                          disclosedPrior: metric.disclosedPrior,
                          disclosedYoyPct: metric.disclosedYoyPct,
                          crossReportPrior: metric.prior,
                          metric: metric.metric,
                        });
                        const tone = yoyTone(yoy);
                        const badge = deltaLabel(yoy);
                        return (
                          <div key={metric.metric}>
                            <span>{metric.label}</span>
                            <strong>{formatMetricValue(metric.metric, metric.value)}</strong>
                            {!yoy ? (
                              <small>暂无同比</small>
                            ) : (
                              <small
                                className={tone === 'up' ? 'rh-ashare-up' : tone === 'down' ? 'rh-ashare-down' : undefined}
                                title={metricYoyHoverTitle(metric)}
                              >
                                {tone === 'up' ? <Icon name="arrowUp" size={10} /> : null}
                                {tone === 'down' ? <Icon name="arrowDown" size={10} /> : null}
                                {badge}
                              </small>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Link>
                  <div className="rh-card-meta">
                    <div className="rh-periods">
                      {periodTokens.length ? (
                        periodTokens.map((token) => (
                          <Link
                            key={token}
                            href={`/${item.code}?period=${encodeURIComponent(token)}`}
                            className={`rh-period-btn${token === displayPeriod ? ' current' : ''}`}
                            title={token === displayPeriod ? `当前展示 ${periodDisplay(token)}` : `打开 ${periodDisplay(token)}`}
                          >
                            {token}
                          </Link>
                        ))
                      ) : (
                        <span className="rh-periods-empty">暂无期次</span>
                      )}
                    </div>
                    <span className="rh-freshness" title={freshnessTooltip(item)}>
                      {freshnessLabel(freshIso)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasMoreCards ? (
          <div ref={loadMoreRef} className="rh-load-more" aria-hidden="true">
            <span>加载更多…</span>
          </div>
        ) : null}

        {filtered.length > 0 && !loading && listedOutsidePoolCandidates.length > 0 ? (
          <div className="rh-sibling-candidates" role="region" aria-label="未在监控池的相关公司">
            <p className="rh-sibling-candidates-title">
              还有 {listedOutsidePoolCandidates.length} 家相关公司未在监控池，点选加入：
            </p>
            <ul className="rh-listed-candidates rh-listed-candidates-inline">
              {listedOutsidePoolCandidates.map((listed) => (
                <li key={listed.code}>
                  <button
                    type="button"
                    onClick={() => { void openMissingCompanyDialog({ listed, query: search.trim(), fromVoice: voice.active }); }}
                  >
                    <span className="rh-listed-candidate-name">{listed.name}</span>
                    <span className="rh-listed-candidate-code">{listed.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!filtered.length && !loading && (
          <div className="rh-empty">
            <b>没有符合条件的公司</b>
            {listedOutsidePoolCandidates.length > 1 ? (
              <>
                <p>识别到多家相关公司，但不在当前监控池。点选要加入的一家：</p>
                <ul className="rh-listed-candidates">
                  {listedOutsidePoolCandidates.map((listed) => (
                    <li key={listed.code}>
                      <button
                        type="button"
                        onClick={() => { void openMissingCompanyDialog({ listed, query: search.trim(), fromVoice: voice.active }); }}
                      >
                        <span className="rh-listed-candidate-name">{listed.name}</span>
                        <span className="rh-listed-candidate-code">{listed.code}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : listedOutsidePool ? (
              <>
                <p>
                  已识别到「{listedOutsidePool.name}」（{listedOutsidePool.code}），但不在当前监控池。
                </p>
                <button
                  type="button"
                  onClick={() => { void openMissingCompanyDialog({ listed: listedOutsidePool, query: search.trim(), fromVoice: voice.active }); }}
                >
                  加入监控池
                </button>
              </>
            ) : (
              <>
                <p>
                  {keyword
                    ? '未匹配到监控池或识别名录中的公司。可换简称 / 六位代码；名录缺漏可上报管理员。'
                    : '试试调整行业，或换一个公司简称 / 六位代码；完整问题请点发送走追问路径。'}
                </p>
                <div className="rh-empty-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setIndustry('全部');
                    }}
                  >
                    清除筛选
                  </button>
                  {keyword ? (
                    <button
                      type="button"
                      className="rh-empty-report"
                      disabled={reportBusy}
                      onClick={() => void reportCurrentSearchMissing()}
                    >
                      {reportBusy ? '上报中…' : '上报管理员'}
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <footer className="rh-footnote">数据来自公开财报与公告列表温和轮询；关键数字可定位原文。内容仅供研究参考。</footer>

      {waitToast && (
        <div className="rh-wait-toast" role="status" aria-live="polite">
          {waitToast}
        </div>
      )}

      {dialog && (
        <div
          className="rh-dialog-backdrop"
          role="presentation"
          onClick={() => { if (!dialogBusy) closeBlockingDialog({ resumeListen: true }); }}
        >
          <div
            className="rh-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rh-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            {dialog.kind === 'missing-company' ? (
              <>
                <h2 id="rh-dialog-title">加入监控池</h2>
                <p>
                  已识别到「{dialog.listed.name}」（{dialog.listed.code}），但不在当前监控池。
                  {dialog.query && hasQuestionIntent(dialog.query) ? ' 加入后将继续用刚才的问题进入详情。' : ''}
                  {dialog.fromVoice ? ' 可以说「加入」或「取消」。' : ''}
                </p>
                <div className="rh-dialog-actions">
                  <button type="button" className="rh-dialog-cancel" disabled={dialogBusy} onClick={() => closeBlockingDialog({ resumeListen: true })}>
                    取消
                  </button>
                  <button type="button" className="rh-dialog-confirm" disabled={dialogBusy} onClick={() => void confirmMissingCompany()}>
                    {dialogBusy ? '加入中…' : '加入监控池'}
                  </button>
                </div>
              </>
            ) : dialog.kind === 'voice-confirm' ? (
              <>
                <h2 id="rh-dialog-title">确认公司</h2>
                <p>
                  语音识别到「{dialog.listed.name}」（{dialog.listed.code}）。是这家吗？可以说「确定」或「不是」。
                </p>
                <div className="rh-dialog-actions">
                  <button type="button" className="rh-dialog-cancel" disabled={dialogBusy} onClick={() => closeBlockingDialog({ resumeListen: true })}>
                    不是
                  </button>
                  <button
                    type="button"
                    className="rh-dialog-confirm"
                    disabled={dialogBusy}
                    onClick={() => { void resolveVoiceConfirmYes(dialog); }}
                  >
                    确定
                  </button>
                </div>
              </>
            ) : dialog.kind === 'voice-pick' ? (
              <>
                <h2 id="rh-dialog-title">检索到多个匹配结果</h2>
                <p>你想选择哪一个？可以说序号或名字；选中后会带上刚才的问题继续。</p>
                <ul className="rh-listed-candidates rh-dialog-pick-list">
                  {dialog.candidates.map((listed, index) => (
                    <li key={listed.code}>
                      <button
                        type="button"
                        disabled={dialogBusy}
                        onClick={() => { void resolveVoicePick(dialog, index); }}
                      >
                        <span className="rh-listed-candidate-name">{index + 1}. {listed.name}</span>
                        <span className="rh-listed-candidate-code">
                          {listed.code}{listed.inPool ? ' · 已在池' : ' · 未入池'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="rh-dialog-actions">
                  <button type="button" className="rh-dialog-cancel" disabled={dialogBusy} onClick={() => closeBlockingDialog({ resumeListen: true })}>
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 id="rh-dialog-title">
                  {periodLabelZh(dialog.period)}尚未下载，是否立即采集？
                </h2>
                <p>
                  {dialog.company.name}（{dialog.company.code}）在监控池内，但未找到匹配的
                  {periodLabelZh(dialog.period)}可读财报。确认后将对该代码触发一轮温和积压处理（每次最多下载/解析 1 份）。
                </p>
                <div className="rh-dialog-actions">
                  <button type="button" className="rh-dialog-cancel" disabled={dialogBusy} onClick={() => closeBlockingDialog({ resumeListen: true })}>
                    取消
                  </button>
                  <button type="button" className="rh-dialog-confirm" disabled={dialogBusy} onClick={() => void confirmMissingReport()}>
                    {dialogBusy ? '触发中…' : '立即采集'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {(voice.active || voice.toast) && (
        <div ref={voiceDockRef} className={`rh-eva-dock${voice.active ? ' is-active' : ''}${voicePanelOpen ? ' is-open' : ''}`}>
          {voice.active && <div className="rh-eva-capsule" data-voice-drag-surface="" title="拖动可移动位置">
            <span className="eva-voice-drag-handle" aria-hidden="true">⠿</span>
            <button
              type="button"
              className="rh-eva-activity-toggle"
              aria-label={voicePanelOpen ? '收起语音对话' : '展开语音对话'}
              aria-expanded={voicePanelOpen}
              aria-controls="rh-eva-conversation"
              onClick={() => setVoicePanelOpen((open) => !open)}
            >
              <VoiceActivity state={voiceActivityState(voice)} />
              <VoiceActivityStatus state={voiceActivityState(voice)} className="rh-eva-status" />
            </button>
            <div className="rh-eva-controls">
              <button type="button" className="rh-eva-control" aria-label={voicePanelOpen ? '收起语音对话' : '展开语音对话'} aria-expanded={voicePanelOpen} aria-controls="rh-eva-conversation" title="语音对话" onClick={() => setVoicePanelOpen((open) => !open)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H4v-8a8 8 0 1 1 16 0Z" /><circle cx="8" cy="11.5" r=".8" fill="currentColor" stroke="none" /><circle cx="12" cy="11.5" r=".8" fill="currentColor" stroke="none" /><circle cx="16" cy="11.5" r=".8" fill="currentColor" stroke="none" /></svg>
              </button>
              <button type="button" className="rh-eva-control is-end" aria-label="结束语音" title="结束语音" onClick={() => endHomeVoice()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>
          </div>}
          {voice.toast ? <div className="rh-eva-notice" role="alert">{voice.toast}</div> : null}
          {voice.active && voicePanelOpen ? (
            <div id="rh-eva-conversation" className="rh-eva-panel" role="region" aria-label="语音对话">
              <div className="rh-eva-panel-log">
                {voiceTurns.length === 0 ? (
                  <p className="rh-eva-panel-empty">但说无妨...</p>
                ) : voiceTurns.map((turn, index) => (
                  <p key={`${turn.role}-${index}`} className={turn.role === 'user' ? 'is-user' : 'is-eva'}>
                    {turn.content}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}