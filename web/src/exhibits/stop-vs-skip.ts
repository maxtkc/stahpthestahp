import { COPY } from '../content/copy';
import { NAMES, neighboursOf, platformsOf, type Station } from '../data';
import { escapeHtml } from '../format';
import { costPerRiderS } from '../model';
import { routeColor } from '../routes';
import { figure, widthOf, type Ctx } from './common';

const ACCEL = 1.3;
const SPEEDUP = 8;
const PAUSE_S = 2.5;
const FALLBACK_V = 10;

let cancel: (() => void) | null = null;

/** Position (m) at time t (s) of a train that stops at d for dwell seconds. */
function stopping(t: number, d: number, v: number, dwell: number): number {
  const brake = (v * v) / (2 * ACCEL);
  const tb = (d - brake) / v;
  const ramp = v / ACCEL;
  if (t < tb) {
    return v * t;
  }
  if (t < tb + ramp) {
    const u = t - tb;
    return d - brake + v * u - (ACCEL * u * u) / 2;
  }
  if (t < tb + ramp + dwell) {
    return d;
  }
  if (t < tb + 2 * ramp + dwell) {
    const u = t - tb - ramp - dwell;
    return d + (ACCEL * u * u) / 2;
  }
  return d + brake + v * (t - tb - 2 * ramp - dwell);
}

const clock = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function stopVsSkip(parent: HTMLElement, s: Station, ctx: Ctx): void {
  cancel?.();
  cancel = null;
  const nb = neighboursOf(s).sort((a, b) =>
    a.pattern.dir.localeCompare(b.pattern.dir),
  )[0];
  if (!nb) {
    return;
  }
  const el = figure(parent, COPY.detail.a, COPY.detail.aBody);
  const plat = platformsOf(s).find(
    (p) => p.route === nb.pattern.route && p.dir === nb.pattern.dir,
  );
  const all = plat ? plat.bands.indexOf('all') : -1;
  const d1 = nb.here.dist - nb.prev.dist;
  const d2 = nb.next.dist - nb.here.dist;
  const vRaw = (all >= 0 && plat?.v_in[all]) || FALLBACK_V;
  const v = Math.min(vRaw, Math.sqrt(2 * ACCEL * Math.min(d1, d2)));
  const cost = costPerRiderS(s, ctx.cost);
  const dwell = Math.max(0, cost - v / ACCEL);
  const lost = dwell + v / ACCEL;
  const total = (d1 + d2) / v;

  const W = widthOf(el);
  const pad = 40;
  const x = (m: number): number => pad + ((W - 2 * pad) * m) / (d1 + d2);
  const color = routeColor(nb.pattern.route);
  const name = (id: string): string => escapeHtml(NAMES.get(id) ?? id);
  const lane = (y: number, label: string, id: string): string => `
    <text x="4" y="${y - 30}" font-size="12" fill="var(--text-muted)">${label}</text>
    ${[0, d1, d1 + d2]
      .map(
        (m) =>
          `<line x1="${x(m)}" x2="${x(m)}" y1="${y - 19}" y2="${y + 4}" stroke="var(--axis)"/>`,
      )
      .join('')}
    <line x1="4" x2="${W - 4}" y1="${y}" y2="${y}" stroke="var(--track)" stroke-width="2"/>
    <g id="${id}"><rect x="-26" y="${y - 14}" width="24" height="11" rx="3" fill="${color}"/><rect x="0" y="${y - 14}" width="24" height="11" rx="3" fill="${color}"/></g>
    <text id="${id}-t" x="${W - 4}" y="${y - 30}" font-size="12" text-anchor="end" class="tabular-nums" fill="var(--text-secondary)"></text>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} 160" class="w-full" role="img" aria-label="${COPY.detail.aStops(name(s.id))}">
    ${lane(55, COPY.detail.aStops(name(s.id)), 'stop')}
    ${lane(115, COPY.detail.aSkips(name(s.id)), 'skip')}
    ${[nb.prev, nb.here, nb.next]
      .map(
        (n, i) =>
          `<text x="${x(n.dist - nb.prev.dist)}" y="${i === 1 ? 154 : 138}" font-size="12" text-anchor="${['start', 'middle', 'end'][i]}" fill="var(--text-muted)" ${i === 1 ? 'font-weight="600"' : ''}>${name(n.id)}</text>`,
      )
      .join('')}
  </svg>
  <p class="text-xs text-secondary">${Math.round(d1)} m in, ${Math.round(d2)} m out, cruising at ${Math.round(v * 3.6)} km/h. This stop costs a passing rider <b class="tabular-nums text-fg">${Math.round(cost)} s</b>${dwell === 0 && cost < v / ACCEL ? ' (less than the braking alone, so the animation shows braking only)' : ''}.</p>`;

  const svg = el.querySelector('svg') as SVGSVGElement;
  const stopG = svg.querySelector('#stop') as SVGGElement;
  const skipG = svg.querySelector('#skip') as SVGGElement;
  const stopT = svg.querySelector('#stop-t') as SVGTextElement;
  const skipT = svg.querySelector('#skip-t') as SVGTextElement;
  const end = total + lost;

  const draw = (t: number): void => {
    const sk = Math.min(t, total);
    const st = Math.min(stopping(t, d1, v, dwell), d1 + d2);
    skipG.setAttribute(
      'transform',
      `translate(${x(Math.min(v * sk, d1 + d2))},0)`,
    );
    stopG.setAttribute('transform', `translate(${x(st)},0)`);
    skipT.textContent = clock(sk) + (t >= total ? ' arrived' : '');
    stopT.textContent =
      clock(Math.min(t, end)) +
      (t >= end ? ` arrived, +${Math.round(lost)} s` : '');
  };

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    draw(end);
    return;
  }
  let start = performance.now();
  let raf = 0;
  const frame = (now: number): void => {
    if (!svg.isConnected) {
      return;
    }
    let t = ((now - start) / 1000) * SPEEDUP;
    if (t > end + PAUSE_S * SPEEDUP) {
      start = now;
      t = 0;
    }
    draw(t);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  cancel = () => cancelAnimationFrame(raf);
}
