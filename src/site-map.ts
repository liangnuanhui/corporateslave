import { SITES, type Site } from '../shared/sites';

const marker = (site: Site) => `<button type="button" class="site-dot ${site.open ? 'open' : 'closed'}" data-site="${site.id}" style="left:${site.x}%;top:${site.y}%" ${site.open ? '' : 'tabindex="-1" aria-disabled="true"'} aria-label="${site.name}${site.open ? '' : `，${site.detail}`}"><span class="site-dot-ring"></span><span class="site-dot-tag"><strong>${site.name}</strong><small>${site.detail}</small></span></button>`;

export const siteMapMarkup = `
  <div class="site-map" id="site-map">
    <div class="site-map-card">
      <p class="site-map-eyebrow">摸鱼科技 · 全国网点</p>
      <h1 class="site-map-title">今天，去哪儿摸鱼？</h1>
      <div class="site-map-stage">
        <svg class="site-map-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <!-- A rough, asymmetric silhouette — not real geography, but with the landmarks (Bohai
               notch, Shandong's jut, the northeast ear, the Pearl/Yangtze delta bulges, the
               south-west taper, Hainan and Taiwan) that make it read as China at a glance. -->
          <path d="M68,4 L88,10 L82,17 L86,20 L70,23 L78,27 L94,30 L80,34 L86,42 L74,50 L80,55 L70,64 L78,72 L62,80 L46,88 L28,82 L16,68 L6,48 L10,28 L24,10 L46,3 L58,2 Z"/>
          <ellipse cx="54" cy="90" rx="4.5" ry="3.4"/>
          <ellipse cx="87" cy="59" rx="2.6" ry="5.4" transform="rotate(18 87 59)"/>
        </svg>
        ${SITES.map(marker).join('')}
      </div>
      <p class="site-map-hint">点击杭州总部，进入办公室 · 按任意键或点击可跳过</p>
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
    // sensible destination either way, so "skip" and "pick 杭州总部" resolve to the same id.
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
