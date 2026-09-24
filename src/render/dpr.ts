/**
 * How many device pixels the canvas draws per CSS pixel.
 *
 * Phaser's RESIZE scale mode sizes the drawing buffer in CSS pixels and stops there: on a 2× screen
 * a 1332×832 canvas kept a 1332×831 buffer (measured), so the display stretched every pixel of the
 * game picture to twice its size. That — not the font sizes, and not the text rasteriser — is why
 * the floor plan read as furry on a retina laptop while looking fine in a 1× browser.
 *
 * `zoom: 1 / RENDER_SCALE` in the game config makes Phaser keep a buffer this many times larger
 * than the CSS box, which is the fix. The cost is that the camera then measures itself in buffer
 * pixels, so every constant expressed in screen pixels has to be scaled by this too — see
 * office-camera.ts, which is the only other place that thinks in screen space.
 *
 * Capped at 2: a 3× buffer is 2.25× the fill rate of a 2× one for a difference nobody can see.
 * Rounded, because a fractional buffer scale puts every drawn edge on a half pixel.
 */
export const RENDER_SCALE = Math.min(Math.max(Math.round(window.devicePixelRatio || 1), 1), 2);

/**
 * Text is rasterised this many times larger than its nominal size, then sampled linearly.
 *
 * `pixelArt: true` puts every texture on NEAREST filtering — right for the character atlas, wrong
 * for type, which the camera almost never shows at exactly 1:1. At the overview the corridor's
 * 1824px fit into ~1330 buffer pixels (×0.73), and NEAREST at 0.73 simply drops every fourth row.
 * Per-Text, so the atlas keeps its hard pixel edges.
 */
export const TEXT_RASTER = 3;
