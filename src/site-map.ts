import { SITES, LON_RANGE, LAT_RANGE, project, type Site } from '../shared/sites';

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
      <p class="site-map-eyebrow">摸鱼科技 · 全国网点</p>
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
    document.body.appendChild(overlay);
    let done = false;
    // A key or a click anywhere finishes the screen at once — the only open site is the sole
    // sensible destination either way, so "skip" and "pick the open site" resolve to the same id.
    const finish = (id: string) => {
      if (done) return; done = true;
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
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
