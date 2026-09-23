import test from 'node:test';
import assert from 'node:assert/strict';
import { faces, shade, depthOf } from '../src/render/oblique.js';

test('a lifted solid draws shadow at the footprint, side below the top, top raised by lift', () => {
  const f = faces({ x: 100, y: 200, width: 60, height: 40, lift: 24, top: 0x808080, side: 0 });
  assert.deepEqual(f.shadow, { x: 100, y: 200, width: 60, height: 40 });
  assert.deepEqual(f.top, { x: 100, y: 200 - 24, width: 60, height: 40 });
  // The side face fills the gap between the raised top's bottom edge and the footprint's bottom edge.
  assert.deepEqual(f.side, { x: 100, y: 200 + 40 - 24, width: 60, height: 24 });
});

test('a flat solid has no side face', () => {
  const f = faces({ x: 0, y: 0, width: 10, height: 10, lift: 0, top: 0xffffff, side: 0 });
  assert.equal(f.side.height, 0);
  assert.deepEqual(f.top, { x: 0, y: 0, width: 10, height: 10 });
});

test('shade darkens toward black and never leaves the byte range', () => {
  assert.equal(shade(0xffffff, 0), 0xffffff);
  assert.equal(shade(0xffffff, 1), 0x000000);
  assert.equal(shade(0x8040c0, .5), 0x402060);
  const c = shade(0x010101, .99);
  assert.ok(c >= 0 && c <= 0xffffff);
});

test('depth sorts by the footprint bottom edge, so nearer objects win', () => {
  assert.ok(depthOf({ x: 0, y: 100, width: 10, height: 40 }) > depthOf({ x: 0, y: 100, width: 10, height: 10 }));
  assert.equal(depthOf({ x: 0, y: 100, width: 10, height: 40 }), 140);
});
