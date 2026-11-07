'use client';

import { useEffect, useId, useState } from 'react';
import { clearHomeChatTurns } from '@/lib/chat-surface';
import { type ReaderMemory } from '@/lib/reader-memory';
import { READER_MEMORY_EVENT, clearReaderMemory, deleteReaderNote, readReaderMemory } from '@/lib/reader-memory-client';
import {
  notifyConversationDeleted,
  notifyMemoryCleared,
  readReaderPrefs,
  updateReaderPrefs,
} from '@/lib/reader-prefs-client';
import {
  READING_LEVELS,
  READING_LEVEL_COPY,
  SPEECH_RATES,
  type ReaderPrefs,
  type ReadingLevel,
} from '@/lib/reader-prefs';
import './reader-prefs-dialog.css';

type PrefsTab = 'general' | 'model' | 'voice' | 'profile' | 'cache';

const TABS: Array<{ id: PrefsTab; label: string }> = [
  { id: 'general', label: '常规' },
  { id: 'model', label: '模型' },
  { id: 'voice', label: '语音' },
  { id: 'profile', label: '记忆' },
  { id: 'cache', label: '缓存' },
];

type ModelChoice = { id: string; model: string };
type MemoryRow = { id: string; title: string; updated_at: string };

export default function ReaderPrefsDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const [tab, setTab] = useState<PrefsTab>('general');
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => readReaderPrefs());
  const [models, setModels] = useState<ModelChoice[] | null>(null);
  const [modelsError, setModelsError] = useState('');
  const [memories, setMemories] = useState<MemoryRow[] | null>(null);
  const [memoryError, setMemoryError] = useState('');
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [habit, setHabit] = useState<ReaderMemory>(() => readReaderMemory());
  const [confirmHabitClear, setConfirmHabitClear] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (tab !== 'model') return;
    let cancel = false;
    setModelsError('');
    fetch('/api/reader/models', { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('模型列表暂时读不到');
        return response.json() as Promise<{ models?: ModelChoice[] }>;
      })
      .then((body) => {
        if (cancel) return;
        setModels(Array.isArray(body.models) ? body.models : []);
      })
      .catch(() => {
        if (!cancel) setModelsError('模型列表暂时读不到');
      });
    return () => { cancel = true; };
  }, [tab]);

  useEffect(() => {
    if (tab !== 'cache') return;
    let cancel = false;
    setMemoryError('');
    fetch('/api/conversations', { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('会话暂时读不到');
        return response.json() as Promise<{ conversations?: MemoryRow[] }>;
      })
      .then((body) => {
        if (cancel) return;
        setMemories(Array.isArray(body.conversations) ? body.conversations : []);
      })
      .catch(() => {
        if (!cancel) setMemoryError('会话暂时读不到');
      });
    return () => { cancel = true; };
  }, [tab]);

  useEffect(() => {
    const sync = () => setHabit(readReaderMemory());
    window.addEventListener(READER_MEMORY_EVENT, sync);
    return () => window.removeEventListener(READER_MEMORY_EVENT, sync);
  }, []);

  function patch(next: Partial<ReaderPrefs>) {
    setPrefs(updateReaderPrefs(next));
    if ('memory' in next) setConfirmClear(false);
  }

  async function deleteOne(id: string) {
    setMemoryBusy(true);
    setMemoryError('');
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('删除失败');
      setMemories((rows) => rows?.filter((row) => row.id !== id) ?? []);
      notifyConversationDeleted(id);
    } catch {
      setMemoryError('这条会话没有删掉，请重试');
    } finally {
      setMemoryBusy(false);
    }
  }

  async function clearAll() {
    setMemoryBusy(true);
    setMemoryError('');
    try {
      const response = await fetch('/api/conversations', { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok) throw new Error('清除失败');
      clearHomeChatTurns();
      notifyMemoryCleared();
      setMemories([]);
      setConfirmClear(false);
    } catch {
      setMemoryError('缓存没有清除，请重试');
    } finally {
      setMemoryBusy(false);
    }
  }

  const concreteModels = (models ?? []).filter((item) => !/^(auto|automatic)$/i.test(item.id.trim()) && !/^(auto|automatic)$/i.test(item.model.trim()));
  const knownModel = concreteModels.some((item) => item.id === prefs.modelId);

  return (
    <div className="prefs-backdrop" onClick={onClose}>
      <div
        className="prefs-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <nav className="prefs-nav" aria-label="偏好分组">
          <p className="prefs-kicker" id={titleId}>偏好设置</p>
          <div className="prefs-tabs" role="tablist" aria-orientation="vertical">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                className="prefs-tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>
        <section className="prefs-main" role="tabpanel">
          <button type="button" className="prefs-close" aria-label="关闭" onClick={onClose}>×</button>
          {tab === 'general' ? (
            <>
              <h3>解读风格</h3>
              <p className="prefs-lead">调整表述风格，数据和引用来源保持不变。</p>
              <div className="prefs-choices" role="radiogroup" aria-label="解读风格">
                {READING_LEVELS.map((level) => (
                  <LevelChoice
                    key={level}
                    level={level}
                    checked={prefs.readingLevel === level}
                    onSelect={() => patch({ readingLevel: level })}
                  />
                ))}
              </div>
            </>
          ) : null}
          {tab === 'model' ? (
            <>
              <h3>问答模型</h3>
              <PrefsSwitch
                on={prefs.autoModel}
                label="自动切换"
                hint="按已配置顺序尝试，失败后再换下一个"
                onChange={(autoModel) => patch({ autoModel })}
              />
              {!prefs.autoModel ? (
                <>
                  {modelsError ? <p className="prefs-error">{modelsError}</p> : null}
                  <div className="prefs-choices" role="radiogroup" aria-label="问答模型">
                    {models === null && !modelsError ? <p className="prefs-hint">正在读取已配置的模型…</p> : null}
                    {models !== null && !modelsError && concreteModels.length === 0 ? <p className="prefs-hint">当前没有可手选的问答模型。追问会退回可核验的原文证据。</p> : null}
                    {concreteModels.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        className="prefs-choice"
                        aria-checked={prefs.modelId === item.id}
                        onClick={() => patch({ modelId: item.id })}
                      >
                        <b>{item.model}</b>
                      </button>
                    ))}
                  </div>
                  {models !== null && prefs.modelId !== 'auto' && !knownModel ? (
                    <p className="prefs-hint">上次选择的模型当前不在配置里，问答会按自动切换。</p>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          {tab === 'voice' ? (
            <>
              <h3>语音</h3>
              <PrefsSwitch
                on={prefs.welcome}
                label="启用欢迎语"
                hint="开麦后先说一句「我是 Eva，你的财报智能分析助手。」"
                onChange={(welcome) => patch({ welcome })}
              />
              <p className="prefs-label">语速</p>
              <div className="prefs-segment" role="radiogroup" aria-label="语速">
                {SPEECH_RATES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={prefs.speechRate === item.value}
                    className={prefs.speechRate === item.value ? 'on' : ''}
                    onClick={() => patch({ speechRate: item.value })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {tab === 'profile' ? (
            <HabitPanel
              habit={habit}
              confirmClear={confirmHabitClear}
              onAskClear={() => setConfirmHabitClear(true)}
              onCancelClear={() => setConfirmHabitClear(false)}
              onDelete={(id) => setHabit(deleteReaderNote(id))}
              onClear={() => {
                setHabit(clearReaderMemory());
                setConfirmHabitClear(false);
              }}
            />
          ) : null}
          {tab === 'cache' ? (
            <>
              <h3>缓存</h3>
              <PrefsSwitch
                on={prefs.memory}
                label="会话缓存"
                hint="开启后，追问会带上这次会话里已经问过的内容。"
                onChange={(memory) => patch({ memory })}
              />
              <div className="prefs-memory-head">
                <p className="prefs-label">会话缓存管理</p>
                {confirmClear ? (
                  <span className="prefs-confirm">
                    <button type="button" className="prefs-text" disabled={memoryBusy} onClick={() => setConfirmClear(false)}>取消</button>
                    <button type="button" className="prefs-text danger" disabled={memoryBusy} onClick={() => void clearAll()}>确认清除</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="prefs-text danger"
                    disabled={memoryBusy || !memories?.length}
                    onClick={() => setConfirmClear(true)}
                  >
                    清除缓存
                  </button>
                )}
              </div>
              {memoryError ? <p className="prefs-error">{memoryError}</p> : null}
              {memories === null && !memoryError ? <p className="prefs-hint">正在读取已保存的会话…</p> : null}
              {memories?.length === 0 ? <p className="prefs-hint">还没有保存的追问会话。</p> : null}
              {memories && memories.length > 0 ? (
                <ul className="prefs-memory-list">
                  {memories.map((row) => (
                    <li key={row.id}>
                      <div>
                        <b>{row.title || '未命名会话'}</b>
                        <span>{formatWhen(row.updated_at)}</span>
                      </div>
                      <button type="button" disabled={memoryBusy} onClick={() => void deleteOne(row.id)}>删除</button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function HabitPanel({
  habit,
  confirmClear,
  onAskClear,
  onCancelClear,
  onDelete,
  onClear,
}: {
  habit: ReaderMemory;
  confirmClear: boolean;
  onAskClear: () => void;
  onCancelClear: () => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <>
      <h3>记忆</h3>
      <p className="prefs-lead">记住你的关注方向、提问习惯，持续优化后续应答</p>
      {habit.notes.length === 0 ? (
        <p className="prefs-hint">还没有记忆。多问几家公司，或直接说「记住……」，会记在这里。</p>
      ) : (
        <ul className="prefs-notes">
          {habit.notes.map((note) => (
            <li key={note.id}>
              <div>
                <p>{note.text}</p>
                <small>{note.source === 'saved' ? '你要求记住' : '根据提问记下'}</small>
              </div>
              <button type="button" onClick={() => onDelete(note.id)}>删除</button>
            </li>
          ))}
        </ul>
      )}
      {habit.notes.length > 0 ? (
        <div className="prefs-memory-head">
          {confirmClear ? (
            <span className="prefs-confirm">
              <button type="button" className="prefs-text" onClick={onCancelClear}>取消</button>
              <button type="button" className="prefs-text danger" onClick={onClear}>确认清除</button>
            </span>
          ) : (
            <button type="button" className="prefs-text danger" onClick={onAskClear}>全部清除</button>
          )}
        </div>
      ) : null}
    </>
  );
}

function LevelChoice({
  level,
  checked,
  onSelect,
}: {
  level: ReadingLevel;
  checked: boolean;
  onSelect: () => void;
}) {
  const copy = READING_LEVEL_COPY[level];
  return (
    <button type="button" role="radio" className="prefs-choice" aria-checked={checked} onClick={onSelect}>
      <b>{copy.label}</b>
      <span>{copy.hint}</span>
    </button>
  );
}

function PrefsSwitch({
  on,
  label,
  hint,
  onChange,
}: {
  on: boolean;
  label: string;
  hint: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="prefs-row">
      <div>
        <div className="prefs-row-label">{label}</div>
        <p className="prefs-hint">{hint}</p>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={on ? 'prefs-switch on' : 'prefs-switch'} onClick={() => onChange(!on)}>
        <span />
      </button>
    </div>
  );
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
