'use client';

import '@/app/voice-float.css';

export type VoiceFloatProps = {
  listening: boolean;
  speaking?: boolean;
  busy?: boolean;
  partial?: string;
  hint?: string;
  onEnd: () => void;
  onFinalize?: () => void;
  onBargeIn?: () => void;
  /** Extra head controls (e.g. auto-jump checkbox on detail). */
  headExtra?: React.ReactNode;
};

export function VoiceFloat({
  listening,
  speaking = false,
  busy = false,
  partial = '',
  hint,
  onEnd,
  onFinalize,
  onBargeIn,
  headExtra,
}: VoiceFloatProps) {
  const title = listening
    ? '正在聆听…'
    : speaking
      ? '正在朗读…'
      : busy
        ? '思考中…'
        : '语音';
  const body =
    partial
    || hint
    || (speaking
      ? '回答朗读中，说话或点「打断」可直接接着问'
      : busy
        ? '正在处理，请稍候…'
        : '说出公司名称、代码或问题；停顿即发送');

  return (
    <div className="eva-voice-float" role="status" aria-live="polite">
      <div className="eva-voice-float-head">
        <b>{title}</b>
        {headExtra}
      </div>
      <div className="eva-voice-float-text">{body}</div>
      <div className="eva-voice-float-actions">
        <button type="button" onClick={onEnd}>结束语音</button>
        {listening && onFinalize ? (
          <button type="button" className="primary" onClick={onFinalize}>说完了</button>
        ) : null}
        {(speaking || busy) && !listening && onBargeIn ? (
          <button type="button" className="primary" onClick={onBargeIn}>打断</button>
        ) : null}
      </div>
    </div>
  );
}
