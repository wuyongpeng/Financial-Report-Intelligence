import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { attachVoiceFloatDrag, clampVoiceFloatPosition } from '../lib/voice/float-drag';

function fixture() {
  const attrs = new Set<string>();
  let captured: number | null = null;
  let disconnected = false;
  let resizeContent = () => {};
  const host = Object.assign(new EventTarget(), {
    innerWidth: 1280, innerHeight: 800,
    ResizeObserver: class {
      constructor(callback: () => void) { resizeContent = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
  });
  const style: Record<string, string> & { removeProperty?: (key: string) => void } = {};
  style.removeProperty = (key) => { delete style[key]; };
  const root = Object.assign(new EventTarget(), {
    style, height: 100, control: false, surface: true,
    closest(selector: string) {
      return selector === '[data-voice-drag-surface]' ? (this.surface ? this : null) : (this.control ? this : null);
    },
    getBoundingClientRect() {
      return { left: parseFloat(style.left || '600'), top: parseFloat(style.top || '82'), width: Math.min(320, host.innerWidth - 24), height: this.height };
    },
    setAttribute: (name: string) => { attrs.add(name); },
    removeAttribute: (name: string) => { attrs.delete(name); },
    hasAttribute: (name: string) => attrs.has(name),
    setPointerCapture: (id: number) => { captured = id; },
    hasPointerCapture: (id: number) => captured === id,
    releasePointerCapture: () => { captured = null; },
  });
  const emit = (target: EventTarget, type: string, x: number, y: number, extra = {}) => target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
    clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, ...extra,
  }));
  const stop = attachVoiceFloatDrag(root as unknown as HTMLElement, host as unknown as Window);
  return { host, root, style, emit, stop, resizeContent: () => resizeContent(), isDisconnected: () => disconnected, capture: () => captured };
}

test('free drag keeps default until moved, follows both axes without snapping, and captures mouse', () => {
  const f = fixture();
  assert.equal(f.style.left, undefined, 'default CSS placement is untouched');
  f.emit(f.root, 'pointerdown', 620, 100);
  assert.equal(f.capture(), 1);
  f.emit(f.host, 'pointermove', 621, 101);
  assert.equal(f.style.left, undefined, 'tiny movement is not a drag');
  f.emit(f.host, 'pointermove', 470, 420);
  assert.equal(f.style.left, '450px');
  assert.equal(f.style.top, '402px');
  assert.equal(f.style.transform, 'none');
  f.emit(f.host, 'pointerup', 470, 420);
  assert.equal(f.capture(), null);
  f.stop();
});

test('touch drag is bounded on every edge and resize/content growth keep the window reachable', () => {
  const f = fixture();
  f.emit(f.root, 'pointerdown', 620, 100, { pointerType: 'touch' });
  f.emit(f.host, 'pointermove', 4000, 4000, { pointerType: 'touch' });
  assert.equal(f.style.left, '952px');
  assert.equal(f.style.top, '692px');
  f.emit(f.host, 'pointercancel', 4000, 4000);
  assert.equal(f.capture(), null);
  f.host.innerWidth = 360; f.host.innerHeight = 320;
  f.host.dispatchEvent(new Event('resize'));
  assert.equal(f.style.left, '32px');
  assert.equal(f.style.top, '212px');
  f.root.height = 200;
  f.resizeContent();
  assert.equal(f.style.top, '112px');
  f.emit(f.root, 'pointerdown', 80, 140);
  f.emit(f.host, 'pointermove', -900, -900);
  assert.equal(f.style.left, '8px');
  assert.equal(f.style.top, '8px');
  f.stop();
});

test('buttons/checkboxes, scrollable content, right click and secondary touch do not drag', () => {
  const f = fixture();
  f.root.control = true;
  f.emit(f.root, 'pointerdown', 620, 100);
  f.emit(f.host, 'pointermove', 200, 400);
  assert.equal(f.style.left, undefined);
  f.root.control = false; f.root.surface = false;
  f.emit(f.root, 'pointerdown', 620, 100);
  f.root.surface = true;
  f.emit(f.root, 'pointerdown', 620, 100, { button: 2 });
  f.emit(f.root, 'pointerdown', 620, 100, { isPrimary: false, pointerType: 'touch' });
  f.emit(f.host, 'pointermove', 200, 400);
  assert.equal(f.capture(), null);
  assert.equal(f.style.left, undefined);
  f.stop();
});

test('detach releases capture, disconnects resize observation, resets placement and removes listeners', () => {
  const f = fixture();
  f.emit(f.root, 'pointerdown', 620, 100);
  f.emit(f.host, 'pointermove', 420, 200);
  f.stop();
  assert.equal(f.capture(), null);
  assert.equal(f.style.left, undefined);
  assert.equal(f.isDisconnected(), true);
  f.resizeContent();
  f.emit(f.root, 'pointerdown', 620, 100);
  f.emit(f.host, 'pointermove', 100, 700);
  f.host.dispatchEvent(new Event('resize'));
  assert.equal(f.style.left, undefined);
});

test('non-finite coordinates cannot make the float disappear', () => {
  assert.deepEqual(clampVoiceFloatPosition(NaN, Infinity, 320, 100, { width: 1280, height: 800 }), { left: 8, top: 8 });
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('both voice floats share dragging; detail has one red X, quiet opt-in footer and detail-only copy', () => {
  const home = source('../app/report-home.tsx');
  const detail = source('../app/company-detail.tsx');
  const float = source('../components/voice-float.tsx');
  const provider = source('../components/voice-session-provider.tsx');
  assert.ok(home.includes('useVoiceFloatDrag(voice.active || Boolean(voice.toast))'));
  assert.ok(home.includes('ref={voiceDockRef}') && home.includes('data-voice-drag-surface'));
  assert.ok(home.includes('但说无妨...'));
  assert.ok(float.includes('useVoiceFloatDrag()') && float.includes('data-voice-drag-surface'));
  assert.equal((float.match(/aria-label="结束语音"/g) || []).length, 1);
  assert.ok(float.includes('className="eva-voice-end"'));
  assert.ok(!float.includes('说完了') && !float.includes('onFinalize'));
  assert.ok(float.includes('尽管提问，停顿即发送') && provider.includes('尽管提问，停顿即发送'));
  assert.ok(!float.includes('说出公司名称') && !provider.includes('说出公司名称'));
  assert.ok(float.indexOf('{footerExtra}') > float.indexOf('eva-voice-float-text'));
  assert.ok(detail.includes('[voiceAutoJump, setVoiceAutoJump] = useState(false)'));
  assert.ok(detail.includes('voiceAutoJumpRef = useRef(false)'));
  assert.ok(!detail.includes('setVoiceAutoJump(true)'));
  assert.ok(detail.includes('setVoiceAutoJump(false); // Every explicit voice start'));
  assert.ok(detail.includes('checked={voiceAutoJump}') && detail.includes('setVoiceAutoJump(e.target.checked)'));
  assert.ok(detail.includes('voiceAutoJumpRef.current = e.target.checked'));
  assert.ok(detail.includes('voice.setFloatFooterExtra(null)'));
  assert.ok(detail.includes('if (voiceAutoJumpRef.current)'));
  assert.ok(detail.includes('id="cd-chat-panel"'), 'existing follow-up panel is retained');
  assert.ok(!float.includes('role="dialog"'), 'no second chat panel is introduced');
});
