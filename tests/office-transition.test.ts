import test from 'node:test';
import assert from 'node:assert/strict';
import { CURTAIN_OPAQUE, TRANSITION_TIMEOUT_MS, gateTransition, shouldStartFadeOut } from '../src/office-transition.js';

test('no mismatch and nothing overdue does nothing', () => {
  assert.equal(gateTransition(false, false, 0, 0, 0), 'none');
  assert.equal(gateTransition(false, true, .4, 100, 260), 'none');
});

test('mismatch with no pending transition cuts immediately — the unchanged hard-cut path', () => {
  assert.equal(gateTransition(true, false, 0, 0, 0), 'cut');
  // Curtain state is irrelevant on this path (e.g. a leftover value from a prior cycle).
  assert.equal(gateTransition(true, false, 1, 999, 0), 'cut');
});

test('mismatch with a pending transition and a half-dark curtain waits', () => {
  assert.equal(gateTransition(true, true, .5, 100, 260), 'wait');
});

test('mismatch with a pending transition and an opaque curtain cuts', () => {
  assert.equal(gateTransition(true, true, CURTAIN_OPAQUE, 100, 260), 'cut');
  assert.equal(gateTransition(true, true, 1, 100, 260), 'cut');
  // Just under the threshold still waits.
  assert.equal(gateTransition(true, true, CURTAIN_OPAQUE - .001, 100, 260), 'wait');
});

test('past the deadline cuts regardless of curtain progress', () => {
  assert.equal(gateTransition(true, true, 0, 260, 260), 'cut');
  assert.equal(gateTransition(true, true, .1, 9999, 260), 'cut');
});

test('an overdue transition with no mismatch yet clears the curtain without a rebuild', () => {
  assert.equal(gateTransition(false, true, .3, 300, 260), 'clear');
});

test('TRANSITION_TIMEOUT_MS and CURTAIN_OPAQUE are the named bounds used above', () => {
  assert.equal(gateTransition(true, true, 0, TRANSITION_TIMEOUT_MS, TRANSITION_TIMEOUT_MS), 'cut');
  assert.equal(gateTransition(true, true, CURTAIN_OPAQUE, 0, TRANSITION_TIMEOUT_MS), 'cut');
});

// The bug this round fixed: a second `transition` arriving while one is already pending (a quick
// door in-and-out) must not restart the fade — Phaser's Fade.start() resets progress/alpha
// unconditionally, so calling fadeOut again mid-fade would snap the curtain back to transparent
// and flash the stale scene for a frame.
test('a transition already pending must not restart the fade-out', () => {
  assert.equal(shouldStartFadeOut(false), true, 'no transition in flight — starting the fade is correct');
  assert.equal(shouldStartFadeOut(true), false, 'one already darkening (or held dark) must not be reset');
});
