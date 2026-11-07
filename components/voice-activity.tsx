'use client';

import React, { useSyncExternalStore } from 'react';
import { VoiceBlob } from '@/components/voice-blob';
import { getVoiceLevels, getServerVoiceLevels, subscribeVoiceLevels } from '@/lib/voice/client-level';

export type VoiceActivityState = 'listening' | 'speaking' | 'thinking' | 'arming' | 'idle';

export function voiceActivityState({ listening, speaking, busy, arming }: {
  listening?: boolean; speaking?: boolean; busy?: boolean; arming?: boolean;
}): VoiceActivityState {
  return arming ? 'arming' : speaking ? 'speaking' : busy ? 'thinking' : listening ? 'listening' : 'idle';
}

export const voiceActivityLabels: Record<VoiceActivityState, string> = {
  listening: '正在聆听', speaking: '正在朗读', thinking: '思考中', arming: '即将发送', idle: '语音已连接',
};

/** Real input/output amplitude; state text stays separate from measurement. */
export function VoiceActivity({ state, risk = false }: { state: VoiceActivityState; risk?: boolean }) {
  const levels = useSyncExternalStore(subscribeVoiceLevels, getVoiceLevels, getServerVoiceLevels);
  const level = state === 'speaking' ? levels.tts : state === 'listening' || state === 'arming' ? levels.mic : 0;
  return (
    <span className={`eva-voice-activity is-${state}`} aria-hidden="true">
      <VoiceBlob risk={risk} />
      <span className="eva-voice-wave">
        {[10, 16, 12, 22, 28, 18, 12, 20, 26, 16, 10].map((height, index) => (
          <i key={index} style={{ height: 4 + (height - 4) * level, opacity: 0.45 + level * 0.55 }} />
        ))}
      </span>
    </span>
  );
}


/** Audio bars replace the visible listening label; assistive status remains available. */
export function VoiceActivityStatus({ state, className = '', label }: {
  state: VoiceActivityState; className?: string; label?: string;
}) {
  return (
    <span className={`eva-voice-status ${className}${state === 'listening' ? ' eva-voice-status-sr-only' : ''}`} role="status">
      {label ?? voiceActivityLabels[state]}
    </span>
  );
}
