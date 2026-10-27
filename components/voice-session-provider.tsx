'use client';

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
import { startPcmCapture, type PcmCapture } from '@/lib/voice/client-pcm';
import { isVoiceFarewell } from '@/lib/voice/farewell-intent';
import {
  VOICE_ENDPOINT_MS,
  VOICE_NO_SPEECH_MS,
  VOICE_IDLE_EMPTY_TURNS,
  VOICE_IDLE_EXIT_TOAST,
} from '@/lib/voice/timing';
import { VoiceFloat } from '@/components/voice-float';

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
  partial: string;
  toast: string | null;
  /** Start continuous realtime voice (idempotent if already active). */
  start: () => Promise<void>;
  /** Explicit end (button / farewell / idle / Escape). */
  end: (toast?: string) => void;
  /** Register page-specific utterance handling; cleared on unmount of that page. */
  setUtteranceHandler: (handler: VoiceUtteranceHandler | null) => void;
  /** Page-owned barge-in (abort TTS/ask then resume). Cleared on page unmount. */
  setBargeInHandler: (handler: (() => void) | null) => void;
  /** Optional float head chrome (e.g. detail auto-jump checkbox). */
  setFloatHeadExtra: (node: ReactNode | null) => void;
  setSpeaking: (v: boolean) => void;
  setBusy: (v: boolean) => void;
  setPartial: (text: string) => void;
  /** Stop mic/ASR only — session stays active (for TTS / ask). */
  stopMic: () => void;
  /** After hold (ask/TTS/nav), listen again if session still active. */
  resumeListen: () => void;
  finalizeListen: () => void;
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
  const [partial, setPartialState] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const activeRef = useRef(false);
  const asrSessionRef = useRef<AsrSession | null>(null);
  const pcmCaptureRef = useRef<PcmCapture | null>(null);
  const voicePartialRef = useRef('');
  const voiceUtteranceHandledRef = useRef(false);
  const voiceFinalTimerRef = useRef<number | null>(null);
  const voiceNoSpeechTimerRef = useRef<number | null>(null);
  const voiceEndpointTimerRef = useRef<number | null>(null);
  const voiceEmptyTurnsRef = useRef(0);
  const voiceGenRef = useRef(0);
  const handlerRef = useRef<VoiceUtteranceHandler | null>(null);
  const bargeInHandlerRef = useRef<(() => void) | null>(null);
  const [floatHeadExtra, setFloatHeadExtraState] = useState<ReactNode | null>(null);
  const listenTurnRef = useRef<() => Promise<void>>(async () => undefined);
  const handleUtteranceRef = useRef<(raw: string) => Promise<void>>(async () => undefined);

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

  const releaseVoiceIo = useCallback(() => {
    clearVoiceFinalTimer();
    clearVoiceTurnTimers();
    pcmCaptureRef.current?.stop();
    pcmCaptureRef.current = null;
    asrSessionRef.current?.close();
    asrSessionRef.current = null;
  }, [clearVoiceFinalTimer, clearVoiceTurnTimers]);

  const end = useCallback((message?: string) => {
    activeRef.current = false;
    voiceEmptyTurnsRef.current = 0;
    voiceGenRef.current += 1;
    releaseVoiceIo();
    voicePartialRef.current = '';
    setPartialState('');
    setListening(false);
    setSpeakingState(false);
    setBusyState(false);
    setActive(false);
    if (message) setToast(message);
  }, [releaseVoiceIo]);

  const stopMic = useCallback(() => {
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
    const text = raw.replace(/\s+/g, ' ').trim();
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

    let result: VoiceUtteranceResult | void;
    try {
      result = await handler(text);
    } catch (err) {
      setToast(err instanceof Error ? err.message : '语音处理失败');
      if (activeRef.current) void listenTurnRef.current();
      return;
    }

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

  const finalizeListen = useCallback(() => {
    clearVoiceTurnTimers();
    if (!asrSessionRef.current && !pcmCaptureRef.current) {
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
      if (gen !== voiceGenRef.current) return;
      const pending = voicePartialRef.current.trim();
      asrSessionRef.current?.close();
      asrSessionRef.current = null;
      void handleUtteranceRef.current(pending);
    }, 2500);
  }, [clearVoiceFinalTimer, clearVoiceTurnTimers]);

  const listenTurn = useCallback(async () => {
    if (!activeRef.current) return;
    releaseVoiceIo();
    const gen = ++voiceGenRef.current;
    voiceUtteranceHandledRef.current = false;
    setSpeakingState(false);
    setListening(true);
    voicePartialRef.current = '';
    setPartialState('');

    const fail = (message: string) => {
      if (gen !== voiceGenRef.current) return;
      end(message);
    };

    try {
      const session = openAsrSession((ev) => {
        if (gen !== voiceGenRef.current) return;
        if (ev.type === 'partial') {
          const prev = voicePartialRef.current;
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
                finalizeListen();
              }, VOICE_ENDPOINT_MS);
            }
          }
        }
        if (ev.type === 'final') {
          clearVoiceFinalTimer();
          clearVoiceTurnTimers();
          pcmCaptureRef.current?.stop();
          pcmCaptureRef.current = null;
          asrSessionRef.current?.close();
          asrSessionRef.current = null;
          setListening(false);
          void handleUtteranceRef.current(ev.text || voicePartialRef.current);
        }
        if (ev.type === 'error') fail(ev.message);
      });
      asrSessionRef.current = session;
      const capture = await startPcmCapture((chunk) => session.sendPcm(chunk));
      if (gen !== voiceGenRef.current || asrSessionRef.current !== session) {
        capture.stop();
        return;
      }
      pcmCaptureRef.current = capture;
      voiceNoSpeechTimerRef.current = window.setTimeout(() => {
        voiceNoSpeechTimerRef.current = null;
        if (gen !== voiceGenRef.current) return;
        if (!voicePartialRef.current.trim()) finalizeListen();
      }, VOICE_NO_SPEECH_MS);
    } catch (err) {
      fail(err instanceof Error ? err.message : '无法使用麦克风');
    }
  }, [clearVoiceFinalTimer, clearVoiceTurnTimers, end, finalizeListen, releaseVoiceIo]);

  listenTurnRef.current = listenTurn;

  const resumeListen = useCallback(() => {
    if (!activeRef.current) return;
    void listenTurn();
  }, [listenTurn]);

  const start = useCallback(async () => {
    const secureErr = micSecureContextError();
    if (secureErr) {
      setToast(secureErr);
      return;
    }
    if (activeRef.current) {
      // Already in session — ensure we are listening.
      if (!listening && !speaking && !busy) void listenTurn();
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

  const setBargeInHandler = useCallback((handler: (() => void) | null) => {
    bargeInHandlerRef.current = handler;
  }, []);

  const setFloatHeadExtra = useCallback((node: ReactNode | null) => {
    setFloatHeadExtraState(node);
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

  // Provider itself must NOT end voice on unmount of children — only full app tear-down.
  useEffect(() => () => {
    // Soft release IO if the whole tree goes away (HMR / leave app).
    activeRef.current = false;
    releaseVoiceIo();
  }, [releaseVoiceIo]);

  const api = useMemo<VoiceSessionApi>(() => ({
    active,
    listening,
    speaking,
    busy,
    partial,
    toast,
    start,
    end,
    setUtteranceHandler,
    setBargeInHandler,
    setFloatHeadExtra,
    setSpeaking: setSpeakingState,
    setBusy: setBusyState,
    setPartial,
    stopMic,
    resumeListen,
    finalizeListen,
    clearToast: () => setToast(null),
  }), [
    active, listening, speaking, busy, partial, toast,
    start, end, setUtteranceHandler, setBargeInHandler, setFloatHeadExtra,
    setPartial, stopMic, resumeListen, finalizeListen,
  ]);

  const showFloat = active || listening || speaking || busy || Boolean(partial);

  return (
    <VoiceSessionContext.Provider value={api}>
      {children}
      {showFloat ? (
        <VoiceFloat
          listening={listening}
          speaking={speaking}
          busy={busy}
          partial={partial}
          hint={active && !listening && !speaking && !busy
            ? '说出公司名称、代码或问题；停顿即发送'
            : undefined}
          onEnd={() => end()}
          onFinalize={listening ? () => finalizeListen() : undefined}
          onBargeIn={(speaking || busy) && !listening
            ? () => {
                const h = bargeInHandlerRef.current;
                if (h) h();
                else {
                  setSpeakingState(false);
                  setBusyState(false);
                  if (activeRef.current) void listenTurnRef.current();
                }
              }
            : undefined}
          headExtra={floatHeadExtra}
        />
      ) : null}
      {toast ? (
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
