/** Bounds how long update()'s authority rule waits for the curtain to darken before cutting
 *  anyway — a frozen fade (backgrounded tab) or a lost snapshot must not strand the view. */
export const TRANSITION_TIMEOUT_MS = 260;
/** Fade progress (0–1) at which the curtain reads as dark enough to cut behind. */
export const CURTAIN_OPAQUE = .999;

export type TransitionAction = 'none' | 'wait' | 'cut' | 'clear';

/**
 * What update()'s authority rule should do this frame. Pure, so the whole state machine —
 * including the timeout and opaque-threshold edges — is unit-testable without touching Phaser.
 *   - no mismatch, no transition overdue           -> 'none'
 *   - mismatch, nothing pending                     -> 'cut' now (unchanged hard-cut path: reconnect, missed message)
 *   - mismatch, pending, curtain not opaque, in time -> 'wait'
 *   - mismatch, and (curtain opaque OR overdue)      -> 'cut'
 *   - no mismatch yet, but a pending transition is overdue -> 'clear' (fade back in, nothing to rebuild)
 */
export function gateTransition(mismatched: boolean, pending: boolean, curtainProgress: number, now: number, deadline: number): TransitionAction {
  const overdue = pending && now >= deadline;
  if (mismatched && (!pending || curtainProgress >= CURTAIN_OPAQUE || overdue)) return 'cut';
  if (overdue) return 'clear';
  return mismatched ? 'wait' : 'none';
}

/** Whether a newly arrived `transition` message should (re)start the curtain fade-out. Phaser's
 *  `Fade.start()` resets progress/alpha unconditionally, so calling `fadeOut` again while one is
 *  already darkening (or holding fully dark) would snap the curtain back to transparent and flash
 *  the stale scene — a second message while one is pending must only refresh the deadline/notice. */
export function shouldStartFadeOut(pending: boolean): boolean { return !pending; }
