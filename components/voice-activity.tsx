import type { CSSProperties } from 'react';

export type VoiceActivityState = 'listening' | 'speaking' | 'thinking' | 'arming' | 'idle';

export function voiceActivityState({ listening, speaking, busy, arming }: {
  listening?: boolean; speaking?: boolean; busy?: boolean; arming?: boolean;
}): VoiceActivityState {
  return arming ? 'arming' : speaking ? 'speaking' : busy ? 'thinking' : listening ? 'listening' : 'idle';
}

export const voiceActivityLabels: Record<VoiceActivityState, string> = {
  listening: '正在聆听', speaking: '正在朗读', thinking: '思考中', arming: '即将发送', idle: '语音已连接',
};

/** Decorative activity, not an audio-level meter. State is also shown in text. */
export function VoiceActivity({ state }: { state: VoiceActivityState }) {
  return (
    <span className={`eva-voice-activity is-${state}`} aria-hidden="true">
      <span className="eva-voice-sphere"><span /></span>
      <span className="eva-voice-wave">
        {[10, 16, 12, 22, 28, 18, 12, 20, 26, 16, 10].map((height, index) => (
          <i key={index} style={{ height, '--wave-delay': `${index * -0.13}s` } as CSSProperties} />
        ))}
      </span>
    </span>
  );
}
