import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VoiceBlob } from '../components/voice-blob';
import { attachBlobMotion, blobEyeOffset, VOICE_BLOB_PATH } from '../lib/voice/blob-motion';
import { hasReportAuditRisk } from '../lib/voice/report-audit-risk';

class MediaQuery extends EventTarget {
  constructor(public matches: boolean) { super(); }
}

function motionFixture(reducedMotion = false, finePointer = true) {
  const reduced = new MediaQuery(reducedMotion);
  const fine = new MediaQuery(finePointer);
  const attributes = [new Map<string, string>(), new Map<string, string>()];
  const eyes = attributes.map((values) => ({ setAttribute: (key: string, value: string) => values.set(key, value) }));
  const frames = new Map<number, FrameRequestCallback>();
  const host = Object.assign(new EventTarget(), {
    matchMedia: (query: string) => query.includes('reduced-motion') ? reduced : fine,
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(1, callback); return 1; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  const svg = { querySelectorAll: () => eyes, getBoundingClientRect: () => ({ left: 0, top: 0, width: 44, height: 44 }) };
  const move = () => host.dispatchEvent(Object.assign(new Event('pointermove'), { pointerType: 'mouse', clientX: 300, clientY: 100 }));
  return { host, svg, attributes, frames, reduced, move };
}

test('provided SVG geometry renders two eyes, blue by default and red only for audit risk', () => {
  const blue = renderToStaticMarkup(React.createElement(VoiceBlob));
  const red = renderToStaticMarkup(React.createElement(VoiceBlob, { risk: true }));
  assert.ok(blue.includes(VOICE_BLOB_PATH));
  assert.ok(blue.includes('viewBox="0 0 200 200"'));
  assert.equal((blue.match(/<ellipse/g) || []).length, 2);
  assert.ok(blue.includes('fill="#3B82F6"'));
  assert.ok(red.includes('fill="#EF4444"'));
  assert.ok(!blue.includes('<script') && !blue.includes('id='));
});

test('audit risk mirrors banner: standard/quarterly unknown are blue; switching clears red', () => {
  const reports = [{ audit_opinion_kind: 'non_standard' }, { audit_opinion_kind: 'standard' }, { audit_opinion_kind: null }, {}, null];
  assert.deepEqual(reports.map(hasReportAuditRisk), [true, false, false, false, false]);
});

test('eye movement uses SVG units and a six-unit circular limit', () => {
  const rect = { left: 10, top: 20, width: 100, height: 200 };
  assert.deepEqual(blobEyeOffset(52.5, 107.5, 85, 75, rect), { x: 0, y: 0 });
  const offset = blobEyeOffset(10000, -10000, 85, 75, rect);
  assert.ok(Math.hypot(offset.x, offset.y) <= 6.00000001);
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
  assert.equal(fixture.attributes[0].get('ry'), '1.2');
  t.mock.timers.tick(120);
  assert.equal(fixture.attributes[0].get('ry'), '12');
  fixture.move();
  stop();
  assert.equal(fixture.frames.size, 0);
  fixture.move();
  fixture.reduced.dispatchEvent(new Event('change'));
  t.mock.timers.tick(10000);
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.attributes[0].get('ry'), '12');
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
  assert.equal(reduced.attributes[0].get('ry'), '12');
  assert.equal(touch.frames.size, 0);
  assert.equal(touch.attributes[0].get('ry'), '1.2');
  stopReduced(); stopTouch();
});
