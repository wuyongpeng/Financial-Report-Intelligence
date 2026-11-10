'use client';

import { useVoiceFloatDrag } from '@/components/use-voice-float-drag';
import '@/app/voice-float.css';
import { VoiceActivity, VoiceActivityStatus, voiceActivityState } from '@/components/voice-activity';
import { VoiceMicButton } from '@/components/voice-mic-button';

export type VoiceFloatProps = {
  listening: boolean;
  reportAuditRisk?: boolean;
  speaking?: boolean;
  busy?: boolean;
  arming?: boolean;
  connecting?: boolean;
  linkFailed?: boolean;
  readyHint?: boolean;
  partial?: string;
  hint?: string;
  onEnd: () => void;
  micMuted?: boolean;
  onToggleMic?: () => void;
  onCancelArm?: () => void;
  /** Quiet footer controls (e.g. detail auto-jump checkbox). */
  footerExtra?: React.ReactNode;
};

export function VoiceFloat({
  listening,
  reportAuditRisk = false,
  speaking = false,
  busy = false,
  arming = false,
  connecting = false,
  linkFailed = false,
  readyHint = false,
  partial = '',
  hint,
  onEnd,
  micMuted = false,
  onToggleMic,
  onCancelArm,
  footerExtra,
}: VoiceFloatProps) {
  const rootRef = useVoiceFloatDrag();

  const title = micMuted
    ? '麦克风已关'
    : arming
      ? '即将发送'
      : listening
        ? '正在聆听…'
        : speaking
          ? '正在朗读…'
          : busy
            ? '思考中…'
            : '语音';
  const body = micMuted
    ? '麦克风已关，会话还在'
    : partial
      || hint
      || (speaking
        ? '回答朗读中，支持随时打断'
        : busy
          ? '正在处理，请稍候…'
          : '尽管提问，停顿即发送');

  return (
    <div
      ref={rootRef}
      className="eva-voice-float"
      role="status"
      aria-live="polite"
    >
      <div
        className="eva-voice-float-head"
        data-voice-drag-surface=""
        title="拖动可移动位置"
      >
        <VoiceActivity state={voiceActivityState({ listening, speaking, busy, arming, connecting, linkFailed })} risk={reportAuditRisk} />
        <VoiceActivityStatus
          state={voiceActivityState({ listening, speaking, busy, arming, connecting, linkFailed })}
          readyHint={readyHint && !micMuted}
          label={micMuted ? '麦克风已关' : connecting || linkFailed || readyHint ? undefined : title}
        />
        <div className="eva-voice-head-actions">
          {onToggleMic ? (
            <VoiceMicButton
              muted={micMuted}
              onClick={onToggleMic}
              className={`eva-voice-mic${micMuted ? ' is-muted' : ''}`}
            />
          ) : null}
          <button type="button" className="eva-voice-end" aria-label="结束语音" title="结束语音" onClick={onEnd}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
      </div>
      {connecting ? null : <div className="eva-voice-float-text">{body}</div>}
      {footerExtra || (arming && onCancelArm) ? (
        <div className="eva-voice-float-footer">
          {footerExtra}
          {arming && onCancelArm ? <button type="button" className="eva-voice-cancel" onClick={onCancelArm}>取消</button> : null}
        </div>
      ) : null}
    </div>
  );
}
