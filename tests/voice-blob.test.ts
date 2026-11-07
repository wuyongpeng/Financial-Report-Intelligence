import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VoiceBlob } from '../components/voice-blob';
import { attachBlobMotion, blobEyeOffset, VOICE_EYES, VOICE_EYE_TRAVEL } from '../lib/voice/blob-motion';
import { hasReportAuditRisk } from '../lib/voice/report-audit-risk';

class MediaQuery extends EventTarget {
  constructor(public matches: boolean) { super(); }
}

function motionFixture(reducedMotion = false, finePointer = true) {
  const reduced = new MediaQuery(reducedMotion);
  const fine = new MediaQuery(finePointer);
  const attributes = [new Map<string, string>(), new Map<string, string>()];
  const eyes = attributes.map((values) => ({ setAttribute: (key: string, value: string) => values.set(key, value) }));
  const blinkAttributes = [new Map<string, string>(), new Map<string, string>()];
  const blinks = blinkAttributes.map((values) => ({ setAttribute: (key: string, value: string) => values.set(key, value) }));
  const frames = new Map<number, FrameRequestCallback>();
  const host = Object.assign(new EventTarget(), {
    matchMedia: (query: string) => query.includes('reduced-motion') ? reduced : fine,
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(1, callback); return 1; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  const svg = { querySelectorAll: (query: string) => query === '[data-voice-eye]' ? eyes : blinks, getBoundingClientRect: () => ({ left: 0, top: 0, width: 44, height: 44 }) };
  const move = () => host.dispatchEvent(Object.assign(new Event('pointermove'), { pointerType: 'mouse', clientX: 300, clientY: 100 }));
  return { host, svg, attributes, blinkAttributes, frames, reduced, move };
}

test('provided SVG geometry renders two eyes, blue by default and red only for audit risk', () => {
  const blue = renderToStaticMarkup(React.createElement(VoiceBlob));
  const red = renderToStaticMarkup(React.createElement(VoiceBlob, { risk: true }));
  assert.ok(blue.includes('<circle cx="100" cy="100" r="96"'));
  assert.ok(!blue.includes('<path'));
  assert.ok(blue.includes('width="15" height="35" rx="7.5"'));
  assert.ok(blue.includes('rotate(-9)'));
  assert.deepEqual(VOICE_EYES, [{ x: 52, y: 69 }, { x: 101, y: 59 }]);
  assert.ok(blue.includes('viewBox="0 0 200 200"'));
  assert.equal((blue.match(/data-voice-eye/g) || []).length, 2);
  assert.ok(blue.includes('fill="#3C93F0"'));
  assert.ok(red.includes('fill="#EF4444"'));
  assert.ok(!blue.includes('<script') && !blue.includes('id='));
});

test('audit risk mirrors banner: standard/quarterly unknown are blue; switching clears red', () => {
  const reports = [{ audit_opinion_kind: 'non_standard' }, { audit_opinion_kind: 'standard' }, { audit_opinion_kind: null }, {}, null];
  assert.deepEqual(reports.map(hasReportAuditRisk), [true, false, false, false, false]);
});

test('eye movement has a 24-unit cap with progressive movement outside the icon', () => {
  const rect = { left: 10, top: 20, width: 100, height: 200 };
  assert.deepEqual(blobEyeOffset(52.5, 107.5, 85, 75, rect), { x: 0, y: 0 });
  const offset = blobEyeOffset(10000, -10000, 85, 75, rect);
  assert.ok(Math.hypot(offset.x, offset.y) <= VOICE_EYE_TRAVEL + 0.00000001);
  assert.deepEqual(blobEyeOffset(1, 2, 85, 75, { ...rect, width: 0 }), { x: 0, y: 0 });
});

test('blink, pointer rAF and media listeners are removed on unmount', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = motionFixture();
  const stop = attachBlobMotion(fixture.svg as unknown as SVGSVGElement, fixture.host as unknown as Window);
  fixture.move();
  assert.equal(fixture.frames.size, 1);
  fixture.frames.get(1)?.(0);
  fixture.frames.clear();
  assert.notEqual(fixture.attributes[0].get('transform'), 'translate(0 0)');
  t.mock.timers.tick(4200);
  assert.equal(fixture.blinkAttributes[0].get('transform'), 'scale(1 .1)');
  t.mock.timers.tick(120);
  assert.equal(fixture.blinkAttributes[0].get('transform'), 'scale(1 1)');
  fixture.move();
  stop();
  assert.equal(fixture.frames.size, 0);
  fixture.move();
  fixture.reduced.dispatchEvent(new Event('change'));
  t.mock.timers.tick(10000);
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.blinkAttributes[0].get('transform'), 'scale(1 1)');
  assert.equal(fixture.attributes[0].get('transform'), 'translate(0 0)');
});

test('reduced-motion disables blink/tracking; touch-only still gets gentle blink', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reduced = motionFixture(true);
  const touch = motionFixture(false, false);
  const stopReduced = attachBlobMotion(reduced.svg as unknown as SVGSVGElement, reduced.host as unknown as Window);
  const stopTouch = attachBlobMotion(touch.svg as unknown as SVGSVGElement, touch.host as unknown as Window);
  reduced.move(); touch.move();
  t.mock.timers.tick(4200);
  assert.equal(reduced.frames.size, 0);
  assert.equal(reduced.blinkAttributes[0].get('transform'), 'scale(1 1)');
  assert.equal(touch.frames.size, 0);
  assert.equal(touch.blinkAttributes[0].get('transform'), 'scale(1 .1)');
  stopReduced(); stopTouch();
});


test('rendered 44px avatar tracks left/right/up/down and keeps changing across the page', () => {
  const rect = { left: 600, top: 200, width: 44, height: 44 };
  const x = rect.left + 52 * 44 / 200;
  const y = rect.top + 69 * 44 / 200;
  const near = blobEyeOffset(x + 50, y, 52, 69, rect);
  const middle = blobEyeOffset(x + 250, y, 52, 69, rect);
  const far = blobEyeOffset(x + 550, y, 52, 69, rect);
  assert.ok(near.x < middle.x && middle.x < far.x);
  assert.ok(far.x * 44 / 200 > 3.5, 'visibly moves by more than 3.5 CSS px');
  assert.ok(blobEyeOffset(x - 250, y, 52, 69, rect).x < -5);
  assert.ok(blobEyeOffset(x, y - 250, 52, 69, rect).y < -5);
  assert.ok(blobEyeOffset(x, y + 250, 52, 69, rect).y > 5);
});


test('right-edge response is visible from the avatar itself, including after dragging', () => {
  const viewport = { width: 1440, height: 900 };
  for (const rect of [
    { left: 1120, top: 82, width: 44, height: 44 },
    { left: 1380, top: 82, width: 44, height: 44 },
    { left: 180, top: 500, width: 40, height: 40 },
  ]) {
    for (const eye of VOICE_EYES) {
      const ex = rect.left + eye.x * rect.width / 200;
      const ey = rect.top + eye.y * rect.height / 200;
      const right = blobEyeOffset(1439, ey, eye.x, eye.y, rect, viewport);
      assert.ok(right.x * rect.width / 200 > 2.5, JSON.stringify({ rect, right }));
      assert.equal(right.y, 0);
      const above = blobEyeOffset(ex, ey - 80, eye.x, eye.y, rect, viewport);
      assert.ok(above.y < -8 && above.x === 0);
      const diagonal = blobEyeOffset(ex + 80, ey + 120, eye.x, eye.y, rect, viewport);
      assert.ok(Math.abs(diagonal.x * 120 - diagonal.y * 80) < 1e-8, 'translation keeps exact screen direction');
    }
  }
});

test('all tilted pill eyes remain inside the 96-unit body over the full travel envelope', () => {
  // A 15x35 rounded capsule is the 20-unit line segment plus a 7.5 radius disk.
  const angle = -9 * Math.PI / 180;
  for (const eye of VOICE_EYES) {
    for (const y of [-10, 10]) {
      const x0 = eye.x - y * Math.sin(angle);
      const y0 = eye.y + y * Math.cos(angle);
      assert.ok(Math.hypot(x0 - 100, y0 - 100) + 7.5 + VOICE_EYE_TRAVEL < 96);
    }
  }
});
