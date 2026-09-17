'use client';

import { useEffect, useRef, useState } from 'react';

export type AnswerVote = 'up' | 'down';

const UP_TAGS = ['内容准确', '易于理解', '内容完善', '其他'] as const;
const DOWN_TAGS = ['答非所问', '存在事实错误', '排版混乱', '逻辑不连贯', '其他'] as const;

export function AnswerFeedback({
  kind,
  submitted,
  onSubmit,
}: {
  kind: AnswerVote | undefined;
  submitted?: boolean;
  onSubmit: () => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const open = Boolean(kind) && !submitted;

  useEffect(() => {
    setTags([]);
  }, [kind]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' });
    });
  }, [open, kind]);

  const preset = kind === 'down' ? DOWN_TAGS : UP_TAGS;
  const title = kind === 'down' ? '你觉得哪里不够好？' : '你觉得什么让你满意？';
  const showThanks = Boolean(kind && submitted);

  function toggleTag(tag: string) {
    setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  }

  function submit() {
    if (!tags.length) return;
    onSubmit();
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
            <div className="cd-fb-foot">
              <button
                type="button"
                className="cd-fb-submit"
                disabled={!tags.length}
                onClick={submit}
              >
                提交
              </button>
            </div>
          </div>
        </div>
      </div>
      <p className={`cd-fb-thanks ${showThanks ? 'show' : ''}`} role="status" aria-live="polite">
        {showThanks ? '感谢你的反馈' : ''}
      </p>
    </div>
  );
}
