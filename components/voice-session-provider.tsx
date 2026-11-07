'use client';
import { finalAsrTranscript } from '@/lib/voice/final-transcript';

import { isFeedbackDrawerOpen } from '@/lib/feedback-draft-client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { openAsrSession, micSecureContextError, type AsrSession } from '@/lib/voice/client-asr';
import { playVoiceCue, primeVoiceCues } from '@/lib/voice/cues';
import { startPcmCapture, type PcmCapture } from '@/lib/voice/client-pcm';
import { speakAnswer } from '@/lib/voice/client-tts';
import { resetVoiceLevels } from '@/lib/voice/client-level';
import { isVoiceFarewell } from '@/lib/voice/farewell-intent';
import {
  VOICE_CANCEL_LINE,
  VOICE_CONNECT_FAIL,
  VOICE_CONNECT_TIMEOUT_MS,
  VOICE_ENDPOINT_MS,
  VOICE_NO_SPEECH_MS,
  VOICE_IDLE_EMPTY_TURNS,
  VOICE_IDLE_EXIT_TOAST,
  VOICE_SEND_COUNTDOWN_MS,
  shouldQuietEndOnEmptyFinalize,
  isMeaningfulBargePartial,
} from '@/lib/voice/timing';
import { VoiceFloat } from '@/components/voice-float';
import { correctAsrHomophones, type AsrCorrectContext } from '@/lib/voice/asr-correct';

export type VoiceUtteranceResult =
  | { action: 'resume' }
  | { action: 'end'; toast?: string }
  /** Page keeps control (ask/TTS/nav); must call resumeListen or end later. */
  | { action: 'hold' };

export type VoiceUtteranceHandler = (
  text: string,
) => void | Promise<VoiceUtteranceResult | void>;

type VoiceSessionApi = {
  active: boolean;
  listening: boolean;
  speaking: boolean;
  busy: boolean;
  /** Utterance settled; send fires when the countdown ends unless cancelled. */
  arming: boolean;
  /** ASR socket or microphone is not ready yet. */
  connecting: boolean;
  /** Connect attempt failed; float shows the failure until the session ends. */
  linkFailed: boolean;
  /** Short “语音已就绪” after the first successful connect. */
  readyHint: boolean;
  partial: string;
  toast: string | null;
  /** Start continuous realtime voice (idempotent if already active). */
  start: () => Promise<void>;
  /** Explicit end (button / farewell / idle / Escape). */
  end: (toast?: string) => void;
  /** Register page-specific utterance handling; cleared on unmount of that page. */
  setUtteranceHandler: (handler: VoiceUtteranceHandler | null) => void;
  /** Lexicon context for ASR homophone rewrite (company/industry/hotwords). */
  setAsrCorrectContext: (ctx: AsrCorrectContext | null) => void;
  /** Optional float footer chrome (e.g. detail auto-jump checkbox). */
  setFloatFooterExtra: (node: ReactNode | null) => void;
  setSpeaking: (v: boolean) => void;
  setBusy: (v: boolean) => void;
  setPartial: (text: string) => void;
  /**
   * While true, heal-stuck auto-listen will not start a provider listen turn.
   * Detail uses this while local barge-in ASR is collecting after interrupting TTS.
   */
  setSuppressAutoListen: (v: boolean) => void;
  /** Stop mic/ASR only — session stays active (for TTS / ask). */
  stopMic: () => void;
  /** After hold (ask/TTS/nav), listen again if session still active. */
  resumeListen: () => void;
  /** Homepage opt-in only: one provider-owned mic while AI/TTS is interruptible. */
  armBargeIn: (onInterrupt: () => void, accept?: (text: string) => boolean) => void;
  /**
   * Stop the current listen turn and flush ASR.
   * Pass `{ userInitiated: true }` for explicit stop / 「说完了」:
   * empty transcript ends the session quietly (no idle toast).
   */
  finalizeListen: (opts?: { userInitiated?: boolean }) => void;
  /** Drop the armed utterance, say a short line, keep the session listening. */
  cancelArmedSend: () => void;
  /** Home hides the bottom float and uses its own voice dock. */
  setHideFloat: (hidden: boolean) => void;
  setReportAuditRisk: (risk: boolean) => void;
  clearToast: () => void;
};

const VoiceSessionContext = createContext<VoiceSessionApi | null>(null);

export function useVoiceSession(): VoiceSessionApi {
  const ctx = useContext(VoiceSessionContext);
  if (!ctx) {
    throw new Error('useVoiceSession must be used within VoiceSessionProvider');
  }
  return ctx;
}

/** Optional: pages that may render outside provider during tests. */
export function useVoiceSessionOptional(): VoiceSessionApi | null {
  return useContext(VoiceSessionContext);
}

export function VoiceSessionProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeakingState] = useState(false);
  const [busy, setBusyState] = useState(false);
  const [arming, setArming] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  const [readyHint, setReadyHint] = useState(false);
  const [partial, setPartialState] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [hideFloat, setHideFloat] = useState(false);
  const [reportAuditRisk, setReportAuditRisk] = useState(false);

  const activeRef = useRef(false);
  const asrSessionRef = useRef<AsrSession | null>(null);
  const pcmCaptureRef = useRef<PcmCapture | null>(null);
  const voicePartialRef = useRef('');
  const voiceUtteranceHandledRef = useRef(false);
  const voiceFinalTimerRef = useRef<number | null>(null);
  const voiceNoSpeechTimerRef = useRef<number | null>(null);
  const voiceEndpointTimerRef = useRef<number | null>(null);
  const voiceArmTimerRef = useRef<number | null>(null);
  const armingRef = useRef(false);
  const armSendRef = useRef<() => void>(() => undefined);
  const connectTimerRef = useRef<number | null>(null);
  const readyHintTimerRef = useRef<number | null>(null);
  const failCloseTimerRef = useRef<number | null>(null);
  /** First successful socket+mic of this session. Later turns do not chime again. */
  const sessionReadyRef = useRef(false);
  const connectingRef = useRef(false);
  const linkFailedRef = useRef(false);
  const voiceEmptyTurnsRef = useRef(0);
  const voiceGenRef = useRef(0);
  const handlerRef = useRef<VoiceUtteranceHandler | null>(null);
  const asrCorrectCtxRef = useRef<AsrCorrectContext | null>(null);
  /** Detail local barge-in ASR collecting — block heal from opening a second mic. */
  const suppressAutoListenRef = useRef(false);
  /** True while finalizeListen is waiting on ASR flush — block heal auto-listen. */
  const finalizingRef = useRef(false);
  const [floatFooterExtra, setFloatFooterExtraState] = useState<ReactNode | null>(null);
  const listenTurnRef = useRef<(barge?: boolean) => Promise<void>>(async () => undefined);
  const bargeRef = useRef<{ onInterrupt: () => void; accept?: (text: string) => boolean } | null>(null);
  const bargeArmedRef = useRef(false);
  const captureOpeningRef = useRef<Promise<PcmCapture> | null>(null);
  const systemTtsAbortRef = useRef<AbortController | null>(null);
  const handleUtteranceRef = useRef<(raw: string) => Promise<void>>(async () => undefined);
  /** One auto-reconnect after mid-session ASR drop; reset on successful listen / explicit end. */
  const asrReconnectRef = useRef(0);

  const clearVoiceFinalTimer = useCallback(() => {
    if (voiceFinalTimerRef.current != null) {
      window.clearTimeout(voiceFinalTimerRef.current);
      voiceFinalTimerRef.current = null;
    }
  }, []);

  const clearVoiceTurnTimers = useCallback(() => {
    if (voiceNoSpeechTimerRef.current != null) {
      window.clearTimeout(voiceNoSpeechTimerRef.current);
      voiceNoSpeechTimerRef.current = null;
    }
    if (voiceEndpointTimerRef.current != null) {
      window.clearTimeout(voiceEndpointTimerRef.current);
      voiceEndpointTimerRef.current = null;
    }
  }, []);

  const clearArmTimer = useCallback(() => {
    if (voiceArmTimerRef.current != null) {
      window.clearTimeout(voiceArmTimerRef.current);
      voiceArmTimerRef.current = null;
    }
    if (armingRef.current) {
      armingRef.current = false;
      setArming(false);
    }
  }, []);

  const releaseVoiceIo = useCallback(() => {
    clearVoiceFinalTimer();
    clearVoiceTurnTimers();
    pcmCaptureRef.current?.stop();
    pcmCaptureRef.current = null;
    asrSessionRef.current?.close();
    asrSessionRef.current = null;
  }, [clearVoiceFinalTimer, clearVoiceTurnTimers]);

  const clearConnectChrome = useCallback(() => {
    if (connectTimerRef.current != null) {
      window.clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    if (readyHintTimerRef.current != null) {
      window.clearTimeout(readyHintTimerRef.current);
      readyHintTimerRef.current = null;
    }
    if (failCloseTimerRef.current != null) {
      window.clearTimeout(failCloseTimerRef.current);
      failCloseTimerRef.current = null;
    }
    connectingRef.current = false;
    linkFailedRef.current = false;
    setConnecting(false);
    setLinkFailed(false);
    setReadyHint(false);
  }, []);

  const end = useCallback((message?: string, opts?: { cue?: 'close' | 'none' }) => {
    const cue = opts?.cue ?? (sessionReadyRef.current ? 'close' : 'none');
    sessionReadyRef.current = false;
    activeRef.current = false;
    const barge = bargeRef.current;
    bargeRef.current = null;
    bargeArmedRef.current = false;
    barge?.onInterrupt();
    systemTtsAbortRef.current?.abort();
    systemTtsAbortRef.current = null;
    resetVoiceLevels();
    suppressAutoListenRef.current = false;
    finalizingRef.current = false;
    voiceEmptyTurnsRef.current = 0;
    asrReconnectRef.current = 0;
    voiceGenRef.current += 1;
    clearArmTimer();
    releaseVoiceIo();
    voicePartialRef.current = '';
    setPartialState('');
    clearConnectChrome();
    setListening(false);
    setSpeakingState(false);
    setBusyState(false);
    setActive(false);
    if (message) setToast(message);
    if (cue === 'close') playVoiceCue('close');
  }, [clearArmTimer, clearConnectChrome, releaseVoiceIo]);

  const stopMic = useCallback(() => {
    bargeRef.current = null;
    bargeArmedRef.current = false;
    voiceGenRef.current += 1;
    releaseVoiceIo();
    setListening(false);
  }, [releaseVoiceIo]);

  const setPartial = useCallback((text: string) => {
    voicePartialRef.current = text;
    setPartialState(text);
  }, []);

  const handleUtterance = useCallback(async (raw: string) => {
    if (voiceUtteranceHandledRef.current) return;
    voiceUtteranceHandledRef.current = true;
    clearVoiceTurnTimers();
    let text = raw.replace(/\s+/g, ' ').trim();
    if (text) {
      const corrected = correctAsrHomophones(text, asrCorrectCtxRef.current ?? {});
      if (corrected !== text) text = corrected;
    }
    voicePartialRef.current = text;
    setPartialState(text);

    if (!text) {
      if (!activeRef.current) {
        setListening(false);
        return;
      }
      voiceEmptyTurnsRef.current += 1;
      if (voiceEmptyTurnsRef.current >= VOICE_IDLE_EMPTY_TURNS) {
        end(VOICE_IDLE_EXIT_TOAST);
        return;
      }
      void listenTurnRef.current();
      return;
    }

    voiceEmptyTurnsRef.current = 0;

    const handler = handlerRef.current;
    // Farewell: let the page speak goodbye TTS when it has a handler; else end here.
    if (isVoiceFarewell(text) && !handler) {
      end();
      return;
    }

    if (!handler) {
      // No page handler yet (route transition) — keep session, retry listen shortly.
      window.setTimeout(() => {
        if (activeRef.current) void listenTurnRef.current();
      }, 400);
      return;
    }

    const handlerGen = voiceGenRef.current;
    let result: VoiceUtteranceResult | void;
    try {
      result = await handler(text);
    } catch (err) {
      if (handlerGen !== voiceGenRef.current || !activeRef.current) return;
      setToast(err instanceof Error ? err.message : '语音处理失败');
      if (activeRef.current) void listenTurnRef.current();
      return;
    }

    if (handlerGen !== voiceGenRef.current || !activeRef.current) return;
    const action = result && typeof result === 'object' ? result.action : 'resume';
    if (action === 'end') {
      end(result && 'toast' in result ? result.toast : undefined);
      return;
    }
    if (action === 'hold') {
      // Page owns the next step (ask/TTS/navigation).
      setListening(false);
      return;
    }
    if (activeRef.current) void listenTurnRef.current();
  }, [clearVoiceTurnTimers, end]);

  handleUtteranceRef.current = handleUtterance;

  const finalizeListen = useCallback((opts?: { userInitiated?: boolean }) => {
    clearArmTimer();
    clearVoiceTurnTimers();
    const userInitiated = Boolean(opts?.userInitiated);
    const pendingNow = voicePartialRef.current.trim();
    // Explicit stop with nothing heard — exit quietly (Esc / 「结束语音」), never idle toast.
    if (shouldQuietEndOnEmptyFinalize(userInitiated) && !pendingNow) {
      end();
      return;
    }
    // Block heal-stuck from reopening the mic during the ASR flush window.
    finalizingRef.current = true;
    if (!asrSessionRef.current && !pcmCaptureRef.current) {
      finalizingRef.current = false;
      if (activeRef.current) void handleUtteranceRef.current(voicePartialRef.current);
      else {
        setListening(false);
      }
      return;
    }
    pcmCaptureRef.current?.stop();
    pcmCaptureRef.current = null;
    asrSessionRef.current?.stop();
    setListening(false);
    clearVoiceFinalTimer();
    const gen = voiceGenRef.current;
    voiceFinalTimerRef.current = window.setTimeout(() => {
      voiceFinalTimerRef.current = null;
      if (gen !== voiceGenRef.current) {
        finalizingRef.current = false;
        return;
      }
      const pending = voicePartialRef.current.trim();
      asrSessionRef.current?.close();
      asrSessionRef.current = null;
      finalizingRef.current = false;
      // User tapped stop/说完了 but ASR never produced text — quiet end, not idle.
      if (shouldQuietEndOnEmptyFinalize(userInitiated) && !pending) {
        end();
        return;
      }
      void handleUtteranceRef.current(pending);
    }, 2500);
  }, [clearArmTimer, clearVoiceFinalTimer, clearVoiceTurnTimers, end]);

  const listenTurn = useCallback(async (barge = false) => {
    if (!activeRef.current || isFeedbackDrawerOpen()) return;
    systemTtsAbortRef.current?.abort();
    systemTtsAbortRef.current = null;
    clearArmTimer();
    releaseVoiceIo();
    const gen = ++voiceGenRef.current;
    voiceUtteranceHandledRef.current = false;
    suppressAutoListenRef.current = barge;
    bargeArmedRef.current = barge;
    finalizingRef.current = false;
    if (!barge) setSpeakingState(false);
    if (!barge) {
      connectingRef.current = true;
      setConnecting(true);
      setLinkFailed(false);
      setListening(false);
    }
    voicePartialRef.current = '';
    setPartialState('');

    const showConnectFailure = (message: string) => {
      if (gen !== voiceGenRef.current || linkFailedRef.current) return;
      linkFailedRef.current = true;
      console.warn('[voice] connect failed', message);
      releaseVoiceIo();
      connectingRef.current = true;
      setConnecting(true);
      setLinkFailed(true);
      setListening(false);
      playVoiceCue('error');
      if (failCloseTimerRef.current != null) window.clearTimeout(failCloseTimerRef.current);
      failCloseTimerRef.current = window.setTimeout(() => {
        failCloseTimerRef.current = null;
        if (gen !== voiceGenRef.current) return;
        end(undefined, { cue: 'none' });
      }, 1600);
    };

    const fail = (message: string) => {
      if (gen !== voiceGenRef.current) return;
      if (activeRef.current && asrReconnectRef.current < 1 && !sessionReadyRef.current) {
        asrReconnectRef.current += 1;
        connectingRef.current = true;
        setConnecting(true);
        setListening(false);
        window.setTimeout(() => {
          if (activeRef.current && gen === voiceGenRef.current) {
            void listenTurnRef.current(barge && !interrupted && Boolean(bargeRef.current));
          }
        }, 500);
        return;
      }
      if (!barge) showConnectFailure(message);
      else end(message, { cue: 'none' });
    };

    let interrupted = !barge;
    const takeOver = (text: string) => {
      if (interrupted) return true;
      const callback = bargeRef.current;
      if (!callback || !(callback.accept ? callback.accept(text) : isMeaningfulBargePartial(text))) return false;
      interrupted = true;
      bargeArmedRef.current = false;
      bargeRef.current = null;
      callback.onInterrupt();
      suppressAutoListenRef.current = false;
      setSpeakingState(false);
      setBusyState(false);
      setListening(true);
      return true;
    };

    try {
      // A pending permission/capture acquisition cannot be cancelled. Wait for its
      // generation cleanup before opening another, so rapid interruptions use one mic.
      while (captureOpeningRef.current) {
        try { await captureOpeningRef.current; } catch { /* previous open failed */ }
        if (gen !== voiceGenRef.current || !activeRef.current) return;
      }
      if (gen !== voiceGenRef.current || !activeRef.current) return;
      let asrReady = false;
      let micReady = false;
      const finishConnect = () => {
        if (gen !== voiceGenRef.current || !asrReady || !micReady) return;
        if (connectTimerRef.current != null) {
          window.clearTimeout(connectTimerRef.current);
          connectTimerRef.current = null;
        }
        connectingRef.current = false;
        setConnecting(false);
        setLinkFailed(false);
        if (!barge) setListening(true);
        if (!sessionReadyRef.current) {
          sessionReadyRef.current = true;
          playVoiceCue('ready');
          setReadyHint(true);
          if (readyHintTimerRef.current != null) window.clearTimeout(readyHintTimerRef.current);
          readyHintTimerRef.current = window.setTimeout(() => {
            readyHintTimerRef.current = null;
            setReadyHint(false);
          }, 2000);
        }
      };
      if (!barge) {
        if (connectTimerRef.current != null) window.clearTimeout(connectTimerRef.current);
        connectTimerRef.current = window.setTimeout(() => {
          connectTimerRef.current = null;
          if (gen !== voiceGenRef.current || (asrReady && micReady)) return;
          showConnectFailure(VOICE_CONNECT_FAIL);
        }, VOICE_CONNECT_TIMEOUT_MS);
      }
      const session = openAsrSession((ev) => {
        if (gen !== voiceGenRef.current) return;
        if (ev.type === 'ready') {
          asrReady = true;
          finishConnect();
          return;
        }
        if (ev.type === 'partial') {
          if (!takeOver(ev.text)) return;
          const prev = voicePartialRef.current;
          if (armingRef.current && ev.text !== prev) {
            if (voiceArmTimerRef.current != null) {
              window.clearTimeout(voiceArmTimerRef.current);
              voiceArmTimerRef.current = null;
            }
            armingRef.current = false;
            setArming(false);
          }
          voicePartialRef.current = ev.text;
          setPartialState(ev.text);
          if (ev.text.trim() && pcmCaptureRef.current) {
            if (voiceNoSpeechTimerRef.current != null) {
              window.clearTimeout(voiceNoSpeechTimerRef.current);
              voiceNoSpeechTimerRef.current = null;
            }
            if (ev.text !== prev || voiceEndpointTimerRef.current == null) {
              if (voiceEndpointTimerRef.current != null) {
                window.clearTimeout(voiceEndpointTimerRef.current);
              }
              voiceEndpointTimerRef.current = window.setTimeout(() => {
                voiceEndpointTimerRef.current = null;
                if (gen !== voiceGenRef.current) return;
                armSendRef.current();
              }, VOICE_ENDPOINT_MS);
            }
          }
        }
        if (ev.type === 'final') {
          const finalText = finalAsrTranscript(ev.text, voicePartialRef.current);
          if (!takeOver(finalText)) {
            if (bargeRef.current && activeRef.current) void listenTurnRef.current(true);
            return;
          }
          bargeArmedRef.current = false;
          clearArmTimer();
          clearVoiceFinalTimer();
          clearVoiceTurnTimers();
          pcmCaptureRef.current?.stop();
          pcmCaptureRef.current = null;
          asrSessionRef.current?.close();
          asrSessionRef.current = null;
          setListening(false);
          void handleUtteranceRef.current(finalText);
        }
        if (ev.type === 'error') fail(ev.message);
      });
      asrSessionRef.current = session;
      const opening = startPcmCapture((chunk) => {
        if (asrReady) session.sendPcm(chunk);
      });
      captureOpeningRef.current = opening;
      let capture: PcmCapture;
      try { capture = await opening; }
      finally { if (captureOpeningRef.current === opening) captureOpeningRef.current = null; }
      if (gen !== voiceGenRef.current || asrSessionRef.current !== session) {
        capture.stop();
        return;
      }
      pcmCaptureRef.current = capture;
      micReady = true;
      finishConnect();
      asrReconnectRef.current = 0;
      if (!barge) voiceNoSpeechTimerRef.current = window.setTimeout(() => {
        voiceNoSpeechTimerRef.current = null;
        if (gen !== voiceGenRef.current) return;
        if (!voicePartialRef.current.trim()) finalizeListen();
      }, VOICE_NO_SPEECH_MS);
    } catch (err) {
      fail(err instanceof Error ? err.message : '无法使用麦克风');
    }
  }, [clearArmTimer, clearVoiceFinalTimer, clearVoiceTurnTimers, end, finalizeListen, releaseVoiceIo]);

  listenTurnRef.current = listenTurn;

  const armSend = useCallback(() => {
    if (!activeRef.current || isFeedbackDrawerOpen()) return;
    if (!voicePartialRef.current.trim()) {
      finalizeListen();
      return;
    }
    if (armingRef.current) return;
    armingRef.current = true;
    setArming(true);
    if (voiceArmTimerRef.current != null) window.clearTimeout(voiceArmTimerRef.current);
    const gen = voiceGenRef.current;
    voiceArmTimerRef.current = window.setTimeout(() => {
      voiceArmTimerRef.current = null;
      armingRef.current = false;
      setArming(false);
      if (gen !== voiceGenRef.current || !activeRef.current) return;
      finalizeListen();
    }, VOICE_SEND_COUNTDOWN_MS);
  }, [finalizeListen]);

  armSendRef.current = armSend;

  const cancelArmedSend = useCallback(() => {
    if (!activeRef.current || isFeedbackDrawerOpen()) return;
    voiceGenRef.current += 1;
    if (voiceArmTimerRef.current != null) {
      window.clearTimeout(voiceArmTimerRef.current);
      voiceArmTimerRef.current = null;
    }
    armingRef.current = false;
    setArming(false);
    releaseVoiceIo();
    voicePartialRef.current = '';
    setPartialState('');
    setListening(false);
    setSpeakingState(true);
    setBusyState(true);
    systemTtsAbortRef.current?.abort();
    const abort = new AbortController();
    systemTtsAbortRef.current = abort;
    void (async () => {
      try {
        await speakAnswer(VOICE_CANCEL_LINE, abort.signal);
      } catch { /* ignore TTS */ }
      finally {
        if (systemTtsAbortRef.current !== abort || abort.signal.aborted || !activeRef.current) return;
        systemTtsAbortRef.current = null;
        setSpeakingState(false);
        setBusyState(false);
        if (activeRef.current) void listenTurnRef.current();
      }
    })();
  }, [releaseVoiceIo]);

  const resumeListen = useCallback(() => {
    if (!activeRef.current || isFeedbackDrawerOpen()) return;
    bargeRef.current = null;
    bargeArmedRef.current = false;
    void listenTurn();
  }, [listenTurn]);

  const armBargeIn = useCallback((onInterrupt: () => void, accept?: (text: string) => boolean) => {
    if (!activeRef.current || isFeedbackDrawerOpen()) return;
    bargeRef.current = { onInterrupt, accept };
    if (bargeArmedRef.current && (asrSessionRef.current || captureOpeningRef.current)) return;
    void listenTurn(true);
  }, [listenTurn]);

  const start = useCallback(async () => {
    const secureErr = micSecureContextError();
    if (secureErr) {
      setToast(secureErr);
      return;
    }
    primeVoiceCues();
    if (activeRef.current) {
      // Already in session — ensure we are listening.
      if (!listening && !speaking && !busy && !connectingRef.current) void listenTurn();
      return;
    }
    activeRef.current = true;
    voiceEmptyTurnsRef.current = 0;
    setActive(true);
    await listenTurn();
  }, [busy, listenTurn, listening, speaking]);

  const setUtteranceHandler = useCallback((handler: VoiceUtteranceHandler | null) => {
    handlerRef.current = handler;
  }, []);

  const setAsrCorrectContext = useCallback((ctx: AsrCorrectContext | null) => {
    asrCorrectCtxRef.current = ctx;
  }, []);

  const setSuppressAutoListen = useCallback((v: boolean) => {
    suppressAutoListenRef.current = v;
  }, []);

  const setFloatFooterExtra = useCallback((node: ReactNode | null) => {
    setFloatFooterExtraState(node);
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      end();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, end]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Heal stuck "active but not listening" (e.g. page forgot resumeListen after TTS).
  useEffect(() => {
    if (!active || listening || speaking || busy || connecting) return;
    const t = window.setTimeout(() => {
      if (!activeRef.current || isFeedbackDrawerOpen()) return;
      if (armingRef.current) return;
      if (suppressAutoListenRef.current) return;
      if (finalizingRef.current) return;
      if (asrSessionRef.current || pcmCaptureRef.current) return;
      void listenTurnRef.current();
    }, 1600);
    return () => window.clearTimeout(t);
  }, [active, listening, speaking, busy, connecting]);

  // Provider itself must NOT end voice on unmount of children — only full app tear-down.
  useEffect(() => () => {
    // Soft release IO if the whole tree goes away (HMR / leave app).
    activeRef.current = false;
    const barge = bargeRef.current;
    bargeRef.current = null;
    bargeArmedRef.current = false;
    barge?.onInterrupt();
    systemTtsAbortRef.current?.abort();
    systemTtsAbortRef.current = null;
    resetVoiceLevels();
    releaseVoiceIo();
  }, [releaseVoiceIo]);

  const api = useMemo<VoiceSessionApi>(() => ({
    active,
    listening,
    speaking,
    busy,
    arming,
    connecting,
    linkFailed,
    readyHint,
    partial,
    toast,
    start,
    end,
    setUtteranceHandler,
    setAsrCorrectContext,
    setFloatFooterExtra,
    setSpeaking: setSpeakingState,
    setBusy: setBusyState,
    setPartial,
    setSuppressAutoListen,
    stopMic,
    resumeListen,
    armBargeIn,
    finalizeListen,
    cancelArmedSend,
    setHideFloat,
    setReportAuditRisk,
    clearToast: () => setToast(null),
  }), [
    active, listening, speaking, busy, arming, connecting, linkFailed, readyHint, partial, toast,
    start, end, setUtteranceHandler, setAsrCorrectContext, setFloatFooterExtra,
    setPartial, setSuppressAutoListen, stopMic, resumeListen, armBargeIn, finalizeListen, cancelArmedSend,
  ]);

  // Typed ask sets busy via detail page — must NOT open the float.
  // Float only after explicit voice.start() (waveform / voice logo).
  // Home hides it and uses the right-side Eva dock instead.
  const showFloat = active && !hideFloat;

  return (
    <VoiceSessionContext.Provider value={api}>
      {children}
      {showFloat ? (
        <VoiceFloat
          reportAuditRisk={reportAuditRisk}
          listening={listening}
          speaking={speaking}
          busy={busy}
          arming={arming}
          connecting={connecting}
          linkFailed={linkFailed}
          readyHint={readyHint}
          partial={partial}
          hint={arming
            ? '即将发送，点取消可重说'
            : connecting
              ? undefined
              : active && !listening && !speaking && !busy
                ? '尽管提问，停顿即发送'
                : undefined}
          onEnd={() => end()}
          onCancelArm={arming ? () => cancelArmedSend() : undefined}
          footerExtra={floatFooterExtra}
        />
      ) : null}
      {toast && !hideFloat ? (
        <div
          className="eva-voice-toast"
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            zIndex: 70,
            maxWidth: 'min(360px, 92vw)',
            padding: '10px 14px',
            borderRadius: 10,
            background: '#edf3ff',
            color: '#415e8c',
            border: '1px solid #c9daf5',
            boxShadow: '0 8px 24px rgba(32,48,71,.12)',
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          {toast}
        </div>
      ) : null}
    </VoiceSessionContext.Provider>
  );
}
