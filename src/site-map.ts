import { SITES, LON_RANGE, LAT_RANGE, project, type Site } from '../shared/sites';
import { ORG_NAME } from '../shared/game';

const marker = (site: Site) => `<button type="button" class="site-dot ${site.open ? 'open' : 'closed'}" data-site="${site.id}" style="left:${site.x}%;top:${site.y}%" ${site.open ? '' : 'tabindex="-1" aria-disabled="true"'} aria-label="${site.name}${site.open ? '' : `，${site.detail}`}"><span class="site-dot-ring"></span><span class="site-dot-tag"><strong>${site.name}</strong><small>${site.detail}</small></span></button>`;

// project()'s per-point x/y are plain fractions of LON_RANGE/LAT_RANGE, so they're already
// aspect-ratio-independent — stretching the box they're drawn into can't move a dot relative to
// the outline. But a degree of longitude is physically shorter than a degree of latitude away
// from the equator (by cos(latitude)), so drawing this box at the raw 62°×35° ratio flattens the
// whole silhouette into a wedge. A single reference latitude — this span's mean, rather than a
// per-point correction that would bend the outline's straight edges into curves — corrects the
// box's aspect ratio to what China actually looks like (~1.44:1) without touching a single
// lon/lat coordinate. Keep this: a future "simplification" back to the raw 62/35 ratio is exactly
// the bug this fixes.
const MEAN_LAT = (LAT_RANGE[0] + LAT_RANGE[1]) / 2;
const MAP_ASPECT_RATIO = (LON_RANGE[1] - LON_RANGE[0]) * Math.cos(MEAN_LAT * Math.PI / 180) / (LAT_RANGE[1] - LAT_RANGE[0]);

// A dozen lon/lat points tracing the broad silhouette only — the northeast extension, an east
// coast that runs roughly north-south, the corner where it turns west in the south, and a wide
// west. Projected through the same `project()` SITES uses, so the coastline and the city dots
// can never independently drift apart. Deliberately spare: more coastal detail read as teeth
// (Pac-Man) rather than a recognizable silhouette on the previous attempt.
const OUTLINE: Array<[number, number]> = [
  [134, 53], [122, 41], [123, 32], [119, 26], [114, 22], [106, 21], [98, 22],
  [80, 28], [74, 40], [80, 49], [105, 50], [122, 50],
];
const outlinePath = 'M' + OUTLINE.map(([lon, lat]) => { const p = project(lon, lat); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' L ') + ' Z';

export const siteMapMarkup = `
  <div class="site-map" id="site-map">
    <div class="site-map-card">
      <p class="site-map-eyebrow">${ORG_NAME} · 全国网点</p>
      <h1 class="site-map-title">今天，去哪？</h1>
      <div class="site-map-stage" style="aspect-ratio:${MAP_ASPECT_RATIO}">
        <svg class="site-map-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="${outlinePath}"/>
        </svg>
        ${SITES.map(marker).join('')}
      </div>
      <p class="site-map-hint">点击${SITES.find(site => site.open)?.name ?? ''}，进入办公室 · 按任意键或点击可跳过</p>
    </div>
  </div>`;

/** Shown once per page load — a returning session (restore-on-load), a fresh register, and a
 *  guest login all pass through here identically (see main.ts), but replaying it on every one
 *  of those within a single tab would slow down exactly the people who reload most: whoever is
 *  testing the game. `shown` is module state, so it resets only on an actual page load. */
let shown = false;

export function showSiteMap(): Promise<string> {
  const fallback = SITES.find(site => site.open)?.id ?? SITES[0].id;
  if (shown) return Promise.resolve(fallback);
  shown = true;
  return new Promise(resolve => {
    const host = document.createElement('div');
    host.innerHTML = siteMapMarkup;
    const overlay = host.firstElementChild as HTMLElement;
    const card = overlay.querySelector<HTMLElement>('.site-map-card')!;
    // The overlay is the doorway into the game picture (`.stage`), not the whole page — it should
    // centre on that on BOTH axes, or the visual weight jumps the instant it closes. Horizontally
    // `.stage` sits left of centre because the fixed-width 下班计划 panel shares its row; vertically
    // it sits high because the control strip and footer occupy the page below it. Centring on the
    // viewport instead left the card 58–130px low and always overlapping the stage's bottom edge.
    // Measured live, not hardcoded: `.stage` is a grid item whose size and centre both depend on
    // the viewport and on `main`'s own max-width.
    const align = () => {
      const stage = document.querySelector('.stage');
      if (!stage) return;
      const box = stage.getBoundingClientRect(), rect = card.getBoundingClientRect(), margin = 16;
      // Below the layout's two-column breakpoint (~851–950px window width) the mission panel still
      // sits beside a now-narrow stage, pushing its centre far enough that a stage-centred card
      // would clip past the viewport's own edge. Clamp to keep it on-screen there; every size this
      // project treats as a real desktop target leaves the target well inside these bounds.
      const place = (target: number, half: number, limit: number) => Math.min(Math.max(target, half + margin), limit - half - margin);
      card.style.left = `${place(box.left + box.width / 2, rect.width / 2, window.innerWidth)}px`;
      card.style.top = `${place(box.top + box.height / 2, rect.height / 2, window.innerHeight)}px`;
    };
    document.body.appendChild(overlay);
    align();
    window.addEventListener('resize', align);
    let done = false;
    // A key or a click anywhere finishes the screen at once — the only open site is the sole
    // sensible destination either way, so "skip" and "pick the open site" resolve to the same id.
    const finish = (id: string) => {
      if (done) return; done = true;
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('resize', align);
      overlay.remove();
      resolve(id);
    };
    const skip = () => finish(fallback);
    overlay.querySelectorAll<HTMLButtonElement>('.site-dot.open').forEach(button => {
      button.onpointerdown = event => { event.stopPropagation(); finish(button.dataset.site!); };
    });
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
  });
}
