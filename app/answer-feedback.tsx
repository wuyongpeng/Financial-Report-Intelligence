'use client';

import { useEffect, useRef, useState } from 'react';

export type AnswerVote = 'up' | 'down';

const UP_TAGS = ['内容准确', '易于理解', '内容完善', '其他'] as const;
const DOWN_TAGS = ['答非所问', '存在事实错误', '排版混乱', '逻辑不连贯', '其他'] as const;

const FALLBACK_ELICITATION = [
  '本期营业收入同比怎么变化？',
  '归母净利润变化的主要原因是什么？',
  '请给出支持上述结论的原文页码。',
];

export function AnswerFeedback({
  kind,
  submitted,
  elicitation,
  asking,
  onSubmit,
  onAsk,
}: {
  kind: AnswerVote | undefined;
  submitted?: boolean;
  elicitation?: string[];
  asking?: boolean;
  onSubmit: () => void;
  onAsk: (question: string) => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const open = Boolean(kind) && !submitted;
  const chips = (elicitation?.filter(Boolean).slice(0, 3).length ? elicitation.slice(0, 3) : FALLBACK_ELICITATION);

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
  const showElicitation = open || showThanks;

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
      {showElicitation && (
        <div className="cd-fb-elicit">
          <small>还可以继续问</small>
          <div className="cd-fb-chips">
            {chips.map((question) => (
              <button
                key={question}
                type="button"
                className="cd-fb-chip"
                disabled={asking}
                onClick={() => onAsk(question)}
              >
                {question}
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
