'use client';

import { useEffect, useRef, useState } from 'react';

export type AnswerVote = 'up' | 'down';

const UP_TAGS = ['内容准确', '易于理解', '内容完善', '其他'] as const;
const DOWN_TAGS = ['答非所问', '存在事实错误', '排版混乱', '逻辑不连贯', '其他'] as const;
const OTHER_TAG = '其他';
const NOTE_MAX = 200;

export type AnswerFeedbackPayload = {
  tags: string[];
  note: string;
};

export function AnswerFeedback({
  kind,
  submitted,
  onSubmit,
}: {
  kind: AnswerVote | undefined;
  submitted?: boolean;
  onSubmit: (payload: AnswerFeedbackPayload) => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [tagKind, setTagKind] = useState(kind);
  const rootRef = useRef<HTMLDivElement>(null);
  const open = Boolean(kind) && !submitted;
  if (kind !== tagKind) {
    setTagKind(kind);
    setTags([]);
    setNote('');
  }

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' });
    });
  }, [open, kind]);

  const preset = kind === 'down' ? DOWN_TAGS : UP_TAGS;
  const title = kind === 'down' ? '你觉得哪里不够好？' : '你觉得什么让你满意？';
  const showThanks = Boolean(kind && submitted);
  const needsNote = tags.includes(OTHER_TAG);
  const canSubmit = tags.length > 0;

  function toggleTag(tag: string) {
    setTags((current) => {
      const next = current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag];
      if (!next.includes(OTHER_TAG)) setNote('');
      return next;
    });
  }

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      tags,
      note: needsNote ? note.trim().slice(0, NOTE_MAX) : '',
    });
  }

  return (
    <div
      ref={rootRef}
      className="cd-fb"
      data-kind={kind ?? ''}
      data-open={open ? 'true' : 'false'}
    >
      <div className={`cd-fb-panel ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="cd-fb-clip">
          <div className="cd-fb-card" role="region" aria-label="回答反馈">
            <p className="cd-fb-title">{title}</p>
            <div className="cd-fb-tags" role="group" aria-label="反馈标签">
              {preset.map((tag) => {
                const on = tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`cd-fb-tag ${on ? 'on' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <div className={`cd-fb-foot${needsNote ? ' with-note' : ''}`}>
              {needsNote ? (
                <input
                  className="cd-fb-note"
                  type="text"
                  value={note}
                  maxLength={NOTE_MAX}
                  placeholder="补充说明（选填，最多 200 字）"
                  aria-label="其他反馈说明"
                  onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
              ) : null}
              <button
                type="button"
                className="cd-fb-submit"
                disabled={!canSubmit}
                onClick={submit}
              >
                提交
              </button>
            </div>
            {needsNote ? (
              <p className="cd-fb-note-count" aria-live="polite">{note.trim().length}/{NOTE_MAX}</p>
            ) : null}
          </div>
        </div>
      </div>
      <p className={`cd-fb-thanks ${showThanks ? 'show' : ''}`} role="status" aria-live="polite">
        {showThanks ? '感谢你的反馈' : ''}
      </p>
    </div>
  );
}
