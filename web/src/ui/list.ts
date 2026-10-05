import { COPY } from '../content/copy';
import type { Station } from '../data';
import { escapeHtml, fmtHours, fmtTick } from '../format';
import { costPerRiderS, type Cost, type Scored } from '../model';
import { bullets, routeColor } from '../routes';
import type { NetScale } from '../scale';

// Train width in px; the track is inset by half of it on each side
const TRAIN_W = 64;
const INSET = TRAIN_W / 2;
const GRID =
  'grid grid-cols-[1.5rem_minmax(0,1fr)_auto] grid-rows-[22px_34px] items-center gap-x-2 sm:grid-cols-[1.75rem_13rem_1fr_5.25rem] sm:grid-rows-1';

// International Symbol of Access, sized to the row text
const ACCESSIBLE = `<svg viewBox="0 0 24 24" class="inline-block h-3.5 w-3.5 align-[-2px] text-muted" fill="currentColor" role="img" aria-label="${COPY.flags.accessible}"><title>${COPY.flags.accessible}</title><circle cx="12" cy="4" r="2"/><path d="M19 13v-2c-1.54.02-3.09-.75-4.07-1.83l-1.29-1.43c-.17-.19-.38-.34-.61-.45-.01 0-.01-.01-.02-.01H13c-.35-.2-.75-.3-1.19-.26C10.76 7.11 10 8.04 10 9.09V15c0 1.1.9 2 2 2h5v5h2v-5.5c0-1.1-.9-2-2-2h-3v-3.45c1.29 1.07 3.25 1.94 5 1.95zm-6.17 5c-.41 1.16-1.52 2-2.83 2-1.66 0-3-1.34-3-3 0-1.31.84-2.41 2-2.83V12.1c-2.28.46-4 2.48-4 4.9 0 2.76 2.24 5 5 5 2.42 0 4.44-1.72 4.9-4h-2.07z"/></svg>`;

const trainCache = new Map<string, string>();

/** Side view of a train in a line colour, as a CSS background. */
function trainImage(color: string, lrv: boolean): string {
  const key = `${color}${lrv}`;
  const hit = trainCache.get(key);
  if (hit) {
    return hit;
  }
  const windows = (x0: number, n: number): string =>
    Array.from(
      { length: n },
      (_, i) =>
        `<rect x="${x0 + i * 9}" y="5" width="6" height="5" rx="1" fill="#fff" fill-opacity=".85"/>`,
    ).join('');
  const body = lrv
    ? `<rect x="1" y="2" width="58" height="13" rx="5" fill="${color}"/><rect x="61" y="2" width="58" height="13" rx="5" fill="${color}"/>${windows(8, 5)}${windows(68, 5)}`
    : `<rect x="1" y="2" width="118" height="13" rx="3" fill="${color}"/>${windows(7, 12)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 20">${body}<circle cx="16" cy="17" r="2" fill="#555"/><circle cx="44" cy="17" r="2" fill="#555"/><circle cx="76" cy="17" r="2" fill="#555"/><circle cx="104" cy="17" r="2" fill="#555"/></svg>`;
  const url = `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
  trainCache.set(key, url);
  return url;
}

function tickMarks(scale: NetScale, label: boolean): string {
  return scale.ticks
    .map((t) => {
      const left = `${(scale(t) * 100).toFixed(3)}%`;
      return label
        ? `<span class="absolute bottom-0 -translate-x-1/2 ${t === 0 || t === scale.ticks[0] || t === scale.ticks.at(-1) ? '' : 'hidden sm:inline'}" style="left:${left}">${fmtTick(t)}</span>`
        : `<span class="absolute w-px ${t === 0 ? 'bg-axis' : 'bg-line'}" style="left:${left};top:2px;bottom:2px"></span>`;
    })
    .join('');
}

function flagText(s: Station): string {
  const out: string[] = [];
  if (s.flags.includes('hub')) {
    out.push(`<span title="${COPY.flags.hub}">hub</span>`);
  }
  if (s.flags.includes('cost_gap')) {
    out.push(`<span title="${COPY.flags.cost_gap}">gap</span>`);
  }
  const icon = s.flags.includes('accessible') ? ` ${ACCESSIBLE}` : '';
  return out.length
    ? `${icon} <span class="text-[10px] uppercase tracking-wide text-muted">${out.join(', ')}</span>`
    : icon;
}

export interface ListView {
  render(
    scored: Scored[],
    scale: NetScale,
    query: string,
    sortDesc: boolean,
    open: string | null,
    cost: Cost,
  ): void;
  /** Element to fill with the open station's details, or null when none is open. */
  detail(): HTMLElement | null;
}

export function createList(
  axis: HTMLElement,
  list: HTMLOListElement,
  onToggle: (key: string) => void,
): ListView {
  const rows = new Map<string, HTMLLIElement>();
  const detail = document.createElement('li');
  detail.className = 'train-row absolute inset-x-0 z-20';
  detail.hidden = true;
  list.append(detail);
  let detailH = 0;
  let layout: () => void = () => {};

  new ResizeObserver(() => {
    const h = detail.hidden ? 0 : detail.offsetHeight;
    if (h !== detailH) {
      detailH = h;
      layout();
    }
  }).observe(detail);

  function row(s: Station): HTMLLIElement {
    let li = rows.get(s.key);
    if (li) {
      return li;
    }
    li = document.createElement('li');
    li.className = `train-row absolute inset-x-0 cursor-pointer text-sm ${GRID} rounded-md hover:bg-surface`;
    li.style.height = 'var(--row)';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.innerHTML = `
      <span data-rank class="text-xs tabular-nums text-muted"></span>
      <span class="truncate">${escapeHtml(s.name)}${bullets(s.routes)}${flagText(s)} <span data-cost class="text-[10px] tabular-nums text-muted" title="${COPY.flags.stopCost}"></span></span>
      <span data-net class="text-right text-xs tabular-nums text-secondary sm:col-start-4 sm:row-start-1"></span>
      <span class="relative col-span-3 h-[34px] self-stretch overflow-hidden sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:h-full">
        <span class="absolute inset-x-0 z-10 h-0.5 rounded-full bg-track" style="bottom:5px"></span>
        <span data-ticks class="absolute inset-y-0" style="left:${INSET}px;right:${INSET}px"></span>
        <span class="absolute inset-y-0 [container-type:inline-size]" style="left:${INSET}px;right:${INSET}px">
          <span class="train absolute left-0" style="bottom:6px;height:${(TRAIN_W * 20) / 120}px;width:${TRAIN_W}px;margin-left:-${INSET}px;background-image:${trainImage(routeColor(s.routes[0]), s.mode === 'green')};background-size:100% 100%"></span>
        </span>
      </span>`;
    li.addEventListener('click', () => onToggle(s.key));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle(s.key);
      }
    });
    list.append(li);
    rows.set(s.key, li);
    return li;
  }

  let lastScale: NetScale | null = null;

  return {
    render(scored, scale, query, sortDesc, open, cost) {
      const q = query.trim().toLowerCase();
      const ordered = sortDesc ? scored : [...scored].reverse();
      const visible = ordered.filter(
        (r) => !q || r.station.name.toLowerCase().includes(q),
      );
      const shown = new Set(visible.map((r) => r.station.key));

      if (scale !== lastScale) {
        axis.innerHTML = `<div class="${GRID.replace('grid-rows-[22px_34px]', '')} text-[10px] tabular-nums text-muted">
          <span class="relative col-span-3 h-3 sm:col-span-1 sm:col-start-3"><span class="absolute inset-y-0" style="left:${INSET}px;right:${INSET}px">${tickMarks(scale, true)}</span></span>
          <span class="hidden text-right sm:block">${COPY.axisLabel}</span></div>`;
        for (const r of scored) {
          const ticks = row(r.station).querySelector(
            '[data-ticks]',
          ) as HTMLElement;
          ticks.innerHTML = tickMarks(scale, false);
        }
        lastScale = scale;
      }
      for (const [key, li] of rows) {
        li.hidden = !shown.has(key);
      }

      const openIdx = visible.findIndex((r) => r.station.key === open);
      detail.hidden = openIdx < 0;
      if (openIdx < 0) {
        detail.innerHTML = '';
        detailH = 0;
      }

      layout = () => {
        visible.forEach((r, i) => {
          const li = row(r.station);
          const extra = openIdx >= 0 && i > openIdx ? detailH : 0;
          li.style.transform = `translateY(calc(${i} * var(--row) + ${extra}px))`;
        });
        if (openIdx >= 0) {
          detail.style.transform = `translateY(calc(${openIdx + 1} * var(--row)))`;
        }
        list.style.height = `calc(${visible.length} * var(--row) + ${openIdx >= 0 ? detailH : 0}px)`;
      };

      visible.forEach((r, i) => {
        const li = row(r.station);
        (li.querySelector('[data-rank]') as HTMLElement).textContent = String(
          r.rank,
        );
        const net = li.querySelector('[data-net]') as HTMLElement;
        net.textContent = `${fmtHours(r.net)} ${COPY.hrs}`;
        net.style.color = r.net > 0 ? 'var(--cut)' : '';
        (li.querySelector('[data-cost]') as HTMLElement).textContent =
          cost.source === 'flat'
            ? ''
            : `${Math.round(costPerRiderS(r.station, cost))} s`;
        const train = li.querySelector('.train') as HTMLElement;
        train.style.setProperty('--pos', scale(r.net).toFixed(5));
        train.style.transitionDelay = `${Math.min(i * 12, 500)}ms`;
        li.setAttribute('aria-expanded', String(r.station.key === open));
        li.classList.toggle('bg-surface', r.station.key === open);
      });
      layout();
    },
    detail: () => (detail.hidden ? null : detail),
  };
}
