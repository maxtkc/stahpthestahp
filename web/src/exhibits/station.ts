import { max } from 'd3-array';
import { COPY } from '../content/copy';
import {
  MODES,
  NAMES,
  dailyRiders,
  neighboursOf,
  platformsOf,
  type Station,
} from '../data';
import { escapeHtml, fmtHours, fmtInt, fmtWalk } from '../format';
import {
  FLAT_RANGE,
  costPerRiderS,
  netH,
  savedH,
  walkH,
  type Cost,
} from '../model';
import { figure, legend, netColor, widthOf, type Ctx } from './common';

const BANDS = ['early', 'am_peak', 'midday', 'pm_peak', 'evening', 'night'];
const BAND_LABELS = [
  'Early',
  'AM peak',
  'Midday',
  'PM peak',
  'Evening',
  'Night',
];
// Service day hours in order, 4am to 3am
const HOURS = Array.from({ length: 24 }, (_, i) => (i + 4) % 24);
const hourLabel = (h: number): string =>
  h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;

const name = (id: string): string => escapeHtml(NAMES.get(id) ?? id);

/** B: riders getting on or off vs riding through, here and at the neighbours. */
export function neighbourRiders(parent: HTMLElement, s: Station): void {
  const nb = neighboursOf(s)[0];
  if (!nb) {
    return;
  }
  const el = figure(parent, COPY.detail.b, COPY.detail.bBody);
  const byId = new Map(MODES[s.mode].stations.map((x) => [x.id, x]));
  const rows = [nb.prev.id, s.id, nb.next.id].map((id) => {
    const st = byId.get(id);
    return { id, r: st ? dailyRiders(st) : null };
  });
  const top = max(rows, (x) => (x.r ? x.r.used + x.r.through : 0)) || 1;
  el.innerHTML =
    legend([
      ['var(--foreground)', COPY.detail.bUsed],
      ['var(--axis)', COPY.detail.bThrough],
    ]) +
    `<div class="space-y-2.5">${rows
      .map(({ id, r }) => {
        const label = `<span class="${id === s.id ? 'font-semibold' : 'text-secondary'} truncate">${name(id)}</span>`;
        if (!r) {
          return `<div class="grid grid-cols-[7rem_1fr] items-center gap-3 text-xs">${label}<span class="text-muted">end of the line, not scored</span></div>`;
        }
        const total = r.used + r.through;
        return `<div class="grid grid-cols-[7rem_1fr] items-center gap-3 text-xs">${label}
          <div class="flex h-6" style="width:${(100 * total) / top}%">
            <div class="flex items-center overflow-visible whitespace-nowrap rounded-l bg-fg px-1.5 text-[11px] tabular-nums text-bg" style="width:${(100 * r.used) / total}%">${r.used / top > 0.15 ? fmtInt(r.used) : ''}</div>
            <div class="flex flex-1 items-center justify-end rounded-r bg-axis px-1.5 text-[11px] tabular-nums">${r.used / top > 0.15 ? '' : `${fmtInt(r.used)} / `}${fmtInt(r.through)}</div>
          </div></div>`;
      })
      .join('')}</div>`;
}

/** C: ons + offs and through riders by hour, per direction. */
export function ridersByHour(parent: HTMLElement, s: Station): void {
  const el = figure(parent, COPY.detail.c, COPY.detail.cBody);
  const W = widthOf(el);
  const H = 110;
  const pad = { l: 34, r: 4, t: 8, b: 18 };
  const dirs = Object.entries(s.dirs).sort(([a], [b]) => a.localeCompare(b));
  const top =
    max(dirs, ([, d]) =>
      max(HOURS, (h) => d.ons[h] + d.offs[h] + d.through[h]),
    ) || 1;
  const bw = (W - pad.l - pad.r) / 24;
  const y = (v: number): number => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  el.innerHTML =
    legend([
      ['var(--foreground)', COPY.detail.bUsed],
      ['var(--axis)', COPY.detail.bThrough],
    ]) +
    dirs
      .map(([, d]) => {
        const bars = HOURS.map((h, i) => {
          const used = d.ons[h] + d.offs[h];
          const x = pad.l + i * bw + 1;
          return `<rect x="${x}" y="${y(used + d.through[h])}" width="${bw - 2}" height="${y(used) - y(used + d.through[h])}" fill="var(--axis)"><title>${hourLabel(h)}: ${fmtInt(used)} on or off, ${fmtInt(d.through[h])} through</title></rect>
            <rect x="${x}" y="${y(used)}" width="${bw - 2}" height="${y(0) - y(used)}" fill="var(--foreground)"><title>${hourLabel(h)}: ${fmtInt(used)} on or off, ${fmtInt(d.through[h])} through</title></rect>`;
        }).join('');
        const labels = HOURS.map((h, i) =>
          i % 4 === 0
            ? `<text class="tick-label" x="${pad.l + i * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${hourLabel(h)}</text>`
            : '',
        ).join('');
        return `<p class="mt-2 text-xs text-secondary">${escapeHtml(d.name ?? '')}bound</p>
          <svg viewBox="0 0 ${W} ${H}" class="w-full">
            <text class="tick-label" x="${pad.l - 4}" y="${y(top) + 8}" text-anchor="end">${fmtInt(top)}</text>
            <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/>
            ${bars}${labels}
          </svg>`;
      })
      .join('');
}

/** D: hours saved on trains vs weighted walking, with the arithmetic. */
export function ledger(parent: HTMLElement, s: Station, ctx: Ctx): void {
  const el = figure(parent, COPY.detail.d, COPY.detail.dBody);
  const c = ctx.cost;
  const saved = savedH(s, c);
  const walk = walkH(s, c);
  const net = saved - walk;
  const top = Math.max(saved, walk, 1e-9);
  const bar = (label: string, v: number, color: string): string =>
    `<div class="grid grid-cols-[9rem_1fr_4rem] items-center gap-3 text-xs"><span class="text-secondary">${label}</span>
      <div class="h-5 rounded" style="width:${(100 * v) / top}%;background:${color}"></div>
      <span class="text-right tabular-nums">${fmtHours(v).replace('+', '')} h</span></div>`;
  el.innerHTML = `<div class="space-y-2">
      ${bar(COPY.detail.dSaved, saved, 'var(--cut)')}
      ${bar(COPY.detail.dWalk, walk, 'var(--keep)')}
    </div>
    <p class="mt-3 text-sm">${COPY.detail.dNet}: <b class="tabular-nums" style="color:${net > 0 ? 'var(--cut)' : 'var(--keep)'}">${fmtHours(net)} hours per weekday</b></p>
    <p class="mt-2 font-mono text-[11px] leading-5 text-muted">
      ${fmtInt(s.through)} through riders × ${Math.round(costPerRiderS(s, c))} s ÷ 3600 = ${saved.toFixed(1)} h<br/>
      ${fmtInt(s.displaced)} on or off × ${Math.round(s.extra_walk_m)} m ÷ ${c.walkSpeed.toFixed(2)} m/s × ${c.walkWeight.toFixed(2)} ÷ 3600 = ${walk.toFixed(1)} h
    </p>`;
}

/** E: catchment along the line and where its riders walk instead. */
export function corridor(parent: HTMLElement, s: Station, ctx: Ctx): void {
  // One diagram per pair of neighbours, whichever direction lists it first
  const pair = (n: { prev: { id: string }; next: { id: string } }): string =>
    [n.prev.id, n.next.id].sort().join('|');
  const nbs = neighboursOf(s).filter(
    (n, i, a) => a.findIndex((m) => pair(m) === pair(n)) === i,
  );
  if (!nbs.length) {
    return;
  }
  const el = figure(parent, COPY.detail.e, COPY.detail.eBody);
  const W = widthOf(el);
  el.innerHTML = nbs
    .slice(0, 2)
    .map((nb) => {
      const p = 0;
      const h = nb.here.dist - nb.prev.dist;
      const n = nb.next.dist - nb.prev.dist;
      const pad = 16;
      const x = (m: number): number => pad + ((W - 2 * pad) * m) / n;
      const midL = h / 2;
      const midR = (h + n) / 2;
      const split = n / 2;
      const extra = (h * (n - h)) / n;
      return `<svg viewBox="0 0 ${W} 96" class="w-full">
        <rect x="${x(midL)}" y="28" width="${x(split) - x(midL)}" height="16" fill="color-mix(in srgb, var(--keep) 25%, transparent)"/>
        <rect x="${x(split)}" y="28" width="${x(midR) - x(split)}" height="16" fill="color-mix(in srgb, var(--cut) 25%, transparent)"/>
        <line x1="${x(p)}" x2="${x(n)}" y1="44" y2="44" stroke="var(--track)" stroke-width="2"/>
        ${[
          [0, nb.prev.id, 'start'],
          [h, nb.here.id, 'middle'],
          [n, nb.next.id, 'end'],
        ]
          .map(
            ([m, id, anchor]) =>
              `<circle cx="${x(m as number)}" cy="44" r="5" fill="${id === s.id ? 'var(--surface)' : 'var(--foreground)'}" stroke="var(--foreground)" stroke-width="2"/>
              <text data-name x="${x(m as number)}" y="68" font-size="11" text-anchor="${anchor}" fill="var(--text-secondary)" ${id === s.id ? 'font-weight="600"' : ''}>${name(id as string)}</text>`,
          )
          .join('')}
        <text class="tick-label" x="${x(h / 2)}" y="20" text-anchor="middle">${Math.round(h)} m</text>
        <text class="tick-label" x="${x((h + n) / 2)}" y="20" text-anchor="middle">${Math.round(n - h)} m</text>
        <line x1="${x(split)}" x2="${x(split)}" y1="24" y2="48" stroke="var(--foreground)" stroke-dasharray="2 2"/>
        <text data-mid class="tick-label" x="${x(split)}" y="88" text-anchor="middle">new midpoint</text>
      </svg>
      <p class="text-xs text-secondary">Blue riders walk back to ${name(nb.prev.id)}, red riders on to ${name(nb.next.id)}. Average extra walk ${fmtWalk(extra, ctx.cost.walkSpeed)}.</p>`;
    })
    .join('');
  // Drop the middle station name a row when it collides with a neighbour
  el.querySelectorAll('svg').forEach((svg) => {
    const names = [...svg.querySelectorAll<SVGTextElement>('[data-name]')];
    const box = names.map((t) => t.getBBox());
    const hits = (a: DOMRect, b: DOMRect): boolean =>
      a.x < b.x + b.width + 4 && b.x < a.x + a.width + 4;
    if (hits(box[0], box[1]) || hits(box[1], box[2])) {
      names[1].setAttribute('y', '82');
      svg.querySelector('[data-mid]')?.setAttribute('y', '100');
      svg.setAttribute('viewBox', `0 0 ${W} 108`);
    }
  });
}

/** F: measured dwell and braking loss per hour band and direction. */
export function costBands(parent: HTMLElement, s: Station, ctx: Ctx): void {
  const plats = platformsOf(s);
  if (!plats.length) {
    return;
  }
  const el = figure(parent, COPY.detail.f, COPY.detail.fBody);
  const dirs = [...new Set(plats.map((p) => p.dir))].sort();
  // Mean over routes per direction and band
  const val = (
    dir: string,
    band: string,
    key: 'dwell_s' | 'accel_s',
  ): number => {
    const xs = plats
      .filter((p) => p.dir === dir)
      .map((p) => p[key][p.bands.indexOf(band)])
      .filter((v): v is number => v !== null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  };
  const current = costPerRiderS(s, ctx.cost);
  const W = widthOf(el);
  const H = 150;
  const pad = { l: 30, r: 4, t: 8, b: 20 };
  const top =
    Math.max(
      current,
      max(dirs, (d) =>
        max(BANDS, (b) => val(d, b, 'dwell_s') + val(d, b, 'accel_s')),
      ) ?? 0,
    ) * 1.1;
  const gw = (W - pad.l - pad.r) / BANDS.length;
  const bw = Math.min(22, (gw - 8) / dirs.length);
  const y = (v: number): number => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const dirName = (d: string): string =>
    Object.entries(s.dirs).find(([k]) => k === d)?.[1].name ?? d;
  const bars = BANDS.map((b, i) =>
    dirs
      .map((d, j) => {
        const dw = val(d, b, 'dwell_s');
        const ac = val(d, b, 'accel_s');
        const x = pad.l + i * gw + (gw - bw * dirs.length) / 2 + j * bw;
        const tip = `<title>${BAND_LABELS[i]}, ${escapeHtml(dirName(d))}bound: ${Math.round(dw)} s dwell + ${Math.round(ac)} s braking</title>`;
        return `<rect x="${x + 1}" y="${y(dw)}" width="${bw - 2}" height="${y(0) - y(dw)}" fill="var(--foreground)" fill-opacity="${j ? 0.6 : 0.9}">${tip}</rect>
          <rect x="${x + 1}" y="${y(dw + ac)}" width="${bw - 2}" height="${y(dw) - y(dw + ac)}" fill="var(--axis)">${tip}</rect>`;
      })
      .join(''),
  ).join('');
  const ticks = [0, 20, 40, 60, 80, 100].filter((t) => t <= top);
  el.innerHTML =
    legend([
      [
        'var(--foreground)',
        `${COPY.detail.fDwell} (${dirs.map((d) => `${escapeHtml(dirName(d))}bound`).join(', then ')})`,
      ],
      ['var(--axis)', COPY.detail.fAccel],
    ]) +
    `<svg viewBox="0 0 ${W} ${H}" class="w-full">
      ${ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)"/><text class="tick-label" x="${pad.l - 4}" y="${y(t) + 3}" text-anchor="end">${t}</text>`).join('')}
      ${bars}
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(current)}" y2="${y(current)}" stroke="var(--cut)" stroke-dasharray="4 3"/>
      <text class="tick-label" x="${W - pad.r}" y="${y(current) - 4}" text-anchor="end" style="fill:var(--cut)">now ${Math.round(current)} s</text>
      ${BAND_LABELS.map((l, i) => `<text class="tick-label" x="${pad.l + i * gw + gw / 2}" y="${H - 5}" text-anchor="middle">${l}</text>`).join('')}
    </svg>`;
}

const GRID_COSTS = Array.from(
  { length: (FLAT_RANGE.max - FLAT_RANGE.min) / 10 + 1 },
  (_, i) => FLAT_RANGE.min + i * 10,
);
const GRID_WEIGHTS = [3, 2.5, 2, 1.5, 1];

/** Grid cells: measured column then flat stop costs, per walk weight. */
export function gridCost(col: number, weight: number, speed: number): Cost {
  return col < 0
    ? { source: 'measured', flatS: 0, walkWeight: weight, walkSpeed: speed }
    : { source: 'flat', flatS: col, walkWeight: weight, walkSpeed: speed };
}

export function heatmapHtml(
  cell: (c: Cost) => { value: number; text: string },
  speed: number,
  activeWeight: number,
): string {
  const cols = [-1, ...GRID_COSTS];
  const vals = GRID_WEIGHTS.map((w) =>
    cols.map((c) => cell(gridCost(c, w, speed))),
  );
  const span = max(vals.flat(), (v) => Math.abs(v.value)) ?? 1;
  return `<div class="grid gap-0.5 text-[10px] tabular-nums sm:text-[11px]" style="grid-template-columns:3.25rem repeat(${cols.length},minmax(0,1fr))">
    <span></span>${cols.map((c) => `<span class="pb-1 text-center text-muted">${c < 0 ? 'meas.' : `${c}s`}</span>`).join('')}
    ${GRID_WEIGHTS.map(
      (w, i) =>
        `<span class="flex items-center text-muted ${w === activeWeight ? 'font-semibold text-fg' : ''}">walk ×${w}</span>${vals[
          i
        ]
          .map(
            (v) =>
              `<span class="rounded-sm py-1.5 text-center" style="background:${netColor(v.value, span)}">${v.text}</span>`,
          )
          .join('')}`,
    ).join('')}
    <span></span><span class="pt-1 text-center text-muted" style="grid-column:span ${cols.length}">time each stop costs</span>
  </div>`;
}

/** G: this stop's net hours across stop cost and walk weight. */
export function stationGrid(parent: HTMLElement, s: Station, ctx: Ctx): void {
  const el = figure(parent, COPY.detail.g, COPY.detail.gBody);
  el.innerHTML = heatmapHtml(
    (c) => {
      const v = netH(s, c);
      return { value: v, text: fmtHours(v) };
    },
    ctx.cost.walkSpeed,
    ctx.cost.walkWeight,
  );
}
