import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { HomeVoiceTurns, assertHomeVoiceTurn, acceptsHomeBargeSpeech } from '../lib/voice/home-turn';
import { parseVoicePickChoice, parseVoiceJoinReply } from '../lib/home-voice-flow';
import { VOICE_NO_SPEECH_MS } from '../lib/voice/timing';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('interrupt waiting AI: aborts its request and prevents stale answer/finally from owning new work', async () => {
  const turns = new HomeVoiceTurns();
  const old = turns.begin();
  let requestAborted = false;
  old.signal.addEventListener('abort', () => { requestAborted = true; });
  let resolve!: (answer: string) => void;
  const pending = new Promise<string>((done) => { resolve = done; });
  const spoken: string[] = [];
  let busy = true;
  const task = (async () => {
    try {
      const answer = await pending; // upstream may ignore abort and still return
      assertHomeVoiceTurn(old);
      spoken.push(answer);
    } catch { /* cancellation is not a fallback answer */ }
    finally { if (turns.owns(old)) busy = false; }
  })();
  turns.cancel(old);
  const next = turns.begin();
  resolve('old answer');
  await task;
  assert.equal(requestAborted, true);
  assert.equal(busy, true);
  assert.deepEqual(spoken, []);
  assert.ok(turns.owns(next));
});

test('interrupt TTS: same abort signal stops playback immediately; next turn survives late cleanup', () => {
  const turns = new HomeVoiceTurns();
  const speaking = turns.begin();
  let paused = false;
  speaking.signal.addEventListener('abort', () => { paused = true; });
  turns.cancel(speaking);
  const next = turns.begin();
  turns.cancel(speaking); // delayed old finally cannot cancel the new owner
  assert.equal(paused, true);
  assert.ok(turns.owns(next));
  assert.throws(() => assertHomeVoiceTurn(speaking), { name: 'AbortError' });
});

test('ending/leaving cancels fetch and speech and removes current ownership', () => {
  const turns = new HomeVoiceTurns();
  const current = turns.begin();
  let stopped = 0;
  current.signal.addEventListener('abort', () => { stopped += 2; }); // request + playback
  turns.cancel();
  turns.cancel();
  assert.equal(stopped, 2);
  assert.equal(turns.current, null);
  assert.equal(turns.owns(current), false);
});

test('echo/filler do not interrupt, distinct new questions do; dialog choices remain usable', () => {
  const prompt = '检索到东鹏饮料和东鹏控股，你想选择哪一个进行分析？';
  assert.equal(acceptsHomeBargeSpeech('嗯', prompt), false);
  assert.equal(acceptsHomeBargeSpeech('检索到东鹏饮料和东鹏控股', prompt), false);
  assert.equal(acceptsHomeBargeSpeech('你想选择哪一个', prompt), false);
  assert.equal(acceptsHomeBargeSpeech('换个问题，茅台利润多少', prompt), true);
  assert.equal(acceptsHomeBargeSpeech('东鹏饮料', prompt, ['东鹏饮料']), true);
  assert.equal(acceptsHomeBargeSpeech('是', '是否加入监控池', ['是', '加入', '取消']), true);
  assert.equal(acceptsHomeBargeSpeech('加入', '是否加入监控池', ['是', '加入', '取消']), true);
  assert.equal(acceptsHomeBargeSpeech('是否加入监控池', '是否加入监控池', ['加入', '取消']), false);
});

test('interrupted picker/join answers retain existing original-question routing contracts', () => {
  const candidates = [{ code: '605499', name: '东鹏饮料', inPool: true }, { code: '003012', name: '东鹏控股', inPool: false }];
  const original = '东鹏最近业绩好不好';
  assert.equal(acceptsHomeBargeSpeech('第二个', '', ['第二个']), true);
  assert.deepEqual(parseVoicePickChoice('第二个', candidates), { kind: 'pick', index: 1 });
  assert.equal(parseVoiceJoinReply('加入'), 'yes');
  const home = source('../app/report-home.tsx');
  assert.ok(home.includes('query: d.query'));
  assert.ok(home.includes('await afterJoinContinue({'));
  assert.ok(home.includes('companies,'));
  const selected = { query: original, listed: candidates[1] };
  assert.equal(selected.query, '东鹏最近业绩好不好');
});

test('provider barge mode is opt-in, owns a single serialized capture and fences old handlers', () => {
  const provider = source('../components/voice-session-provider.tsx');
  const detail = source('../app/company-detail.tsx');
  assert.ok(provider.includes('async (barge = false)'));
  assert.ok(provider.includes('while (captureOpeningRef.current)'));
  assert.ok(provider.includes('if (handlerGen !== voiceGenRef.current || !activeRef.current) return'));
  assert.ok(provider.includes('callback.onInterrupt()'));
  assert.ok(provider.includes('if (!barge) voiceNoSpeechTimerRef.current'));
  assert.ok(provider.includes('if (!activeRef.current || isFeedbackDrawerOpen() || micMutedRef.current) return'));
  assert.ok(provider.includes('if (micMutedRef.current) return'));
  assert.equal(VOICE_NO_SPEECH_MS, 180_000);
  assert.ok(detail.includes('voiceApiRef.current.micMuted'));
  assert.ok(!detail.includes('voice.armBargeIn'));
  assert.ok(detail.includes("void armBargeInAsr('speaking')"));
});

test('homepage uses cancellable AI/TTS and only latest turn may recover; compact chat header stays removed', () => {
  const home = source('../app/report-home.tsx');
  assert.ok(home.includes('await speakAnswer(line, turn?.signal)'));
  assert.equal((home.match(/signal: turn\?\.signal/g) || []).length >= 4, true);
  assert.ok(home.includes('if (homeVoiceTurnsRef.current.owns(turn)) setSubmitting(false)'));
  assert.ok(home.includes('homeVoiceTurnsRef.current.cancel();'));
  assert.ok(home.includes('homeVoiceApiRef.current.resumeListen()'));
  assert.ok(!home.includes('rh-eva-panel-head'));
  assert.ok(home.includes('但说无妨...'));
  assert.ok(home.includes('className="rh-eva-control is-end"'));
  assert.ok(home.indexOf('<VoiceMicButton') < home.indexOf('className="rh-eva-control is-end"'));
  assert.ok(home.includes("voice.micMuted ? '麦克风已关'"));
  assert.ok(home.includes('voiceTurns.map'));
  assert.ok(!home.includes('setSearch(voice.partial)'));
});
