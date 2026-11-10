'use client';

/** Same stroke as the homepage chat bubble: round, unfilled, 22px inside a 44px circle. */
export function VoiceMicButton({
  muted,
  onClick,
  className,
}: {
  muted: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-pressed={muted}
      aria-label={muted ? '打开麦克风' : '关闭麦克风'}
      title={muted ? '打开麦克风' : '关闭麦克风'}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
        <path d="M6 11a6 6 0 0 0 12 0" />
        <path d="M12 17v3" />
        {muted ? <path d="M4 4 20 20" /> : null}
      </svg>
    </button>
  );
}
