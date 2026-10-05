import { max } from 'd3-array';
import { forceCollide, forceSimulation, forceX, forceY } from 'd3-force';
import { scaleLog } from 'd3-scale';
import { COPY } from '../content/copy';
import {
  MODES,
  NAMES,
  dailyRiders,
  type ModeName,
  type Station,
} from '../data';
import { escapeHtml, fmtHours, fmtInt, fmtTick } from '../format';
import { MBTA_IMPLIED_S, type Cost } from '../model';
import { lineName, routeColor } from '../routes';
import type { NetScale } from '../scale';
import { hideTip, showTip } from '../ui/tip';
import { figure, legend, netColor, widthOf, type Ctx } from './common';
import { heatmapHtml } from './station';

const modesIn = (ctx: Ctx): ModeName[] =>
  ctx.settings.mode === 'all' ? ['green', 'subway'] : [ctx.settings.mode];

function hover(
  el: Element,
  html: (target: SVGElement) => string | null,
  onClick?: (target: SVGElement) => void,
): void {
  el.addEventListener('pointermove', (e) => {
    const t = (e.target as SVGElement).closest('[data-k]') as SVGElement | null;
    const h = t && html(t);
    if (h) {
      showTip(h, e as PointerEvent);
    } else {
      hideTip();
    }
  });
  el.addEventListener('pointerleave', hideTip);
  if (onClick) {
    el.addEventListener('click', (e) => {
      const t = (e.target as SVGElement).closest(
        '[data-k]',
      ) as SVGElement | null;
      if (t) {
        hideTip();
        onClick(t);
      }
    });
  }
}

/** Every stop as a dot on the list's net-hours axis, packed to avoid overlap. */
export function swarm(
  parent: HTMLElement,
  ctx: Ctx,
  scale: NetScale,
  onOpen: (key: string) => void,
): void {
  const el = figure(parent, COPY.network.swarm, COPY.network.swarmBody);
  const W = widthOf(el);
  const pad = 24;
  const maxThrough = max(ctx.scored, (r) => r.station.through) ?? 1;
  type Node = { x: number; y: number; tx: number; r: number; key: string };
  const byKey = new Map(ctx.scored.map((r) => [r.station.key, r]));
  const nodes: Node[] = ctx.scored.map((r) => {
    const tx = pad + scale(r.net) * (W - 2 * pad);
    return {
      x: tx,
      y: 0,
      tx,
      r: 3 + 7 * Math.sqrt(r.station.through / maxThrough),
      key: r.station.key,
    };
  });
  forceSimulation(nodes)
    .force('x', forceX<Node>((d) => d.tx).strength(1))
    .force('y', forceY<Node>(0).strength(0.06))
    .force(
      'c',
      forceCollide<Node>((d) => d.r + 1),
    )
    .stop()
    .tick(240);
  const ext = max(nodes, (n) => Math.abs(n.y) + n.r) ?? 20;
  const H = 2 * ext + 36;
  const cy = ext + 8;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="w-full">
    ${scale.ticks
      .map((t) => {
        const x = pad + scale(t) * (W - 2 * pad);
        return `<line x1="${x}" x2="${x}" y1="4" y2="${H - 20}" stroke="${t === 0 ? 'var(--axis)' : 'var(--border)'}"/><text class="tick-label" x="${x}" y="${H - 6}" text-anchor="middle">${fmtTick(t)}</text>`;
      })
      .join('')}
    ${nodes
      .map((n) => {
        const r = byKey.get(n.key)!;
        return `<circle data-k="${n.key}" cx="${n.x}" cy="${cy + n.y}" r="${n.r}" fill="${routeColor(r.station.routes[0])}" fill-opacity="0.8" stroke="${r.net > 0 ? 'var(--cut)' : 'var(--surface)'}" stroke-width="${r.net > 0 ? 1.5 : 1}" class="cursor-pointer"/>`;
      })
      .join('')}
  </svg>`;
  hover(
    el,
    (t) => {
      const r = byKey.get(t.dataset.k ?? '');
      return r
        ? `<b>${escapeHtml(r.station.name)}</b><br/>${fmtHours(r.net)} h/day, rank ${r.rank}<br/>${fmtInt(r.station.through)} through, ${fmtInt(r.station.displaced)} on or off`
        : null;
    },
    (t) => onOpen(t.dataset.k ?? ''),
  );
}

/** Each typical pattern in one direction, stops by distance and coloured by net. */
export function strips(
  parent: HTMLElement,
  ctx: Ctx,
  onOpen: (key: string) => void,
): void {
  const el = figure(parent, COPY.network.strips, COPY.network.stripsBody);
  const W = widthOf(el);
  const byKey = new Map(ctx.scored.map((r) => [r.station.key, r]));
  const span = max(ctx.scored, (r) => Math.abs(r.net)) ?? 1;
  const pats = modesIn(ctx).flatMap((m) =>
    MODES[m].patterns.filter((p) => p.dir === '0').map((p) => ({ m, p })),
  );
  const longest = max(pats, ({ p }) => p.dist_m.at(-1) ?? 0) ?? 1;
  const labelW = 64;
  const x = (d: number): number => labelW + ((W - labelW - 12) * d) / longest;
  const rowH = 30;
  const H = pats.length * rowH + 8;
  el.innerHTML =
    legend([
      ['var(--cut)', 'closing saves time'],
      ['var(--keep)', 'closing costs time'],
      ['var(--axis)', 'end of line, not scored'],
    ]) +
    `<svg viewBox="0 0 ${W} ${H}" class="w-full">${pats
      .map(({ m, p }, i) => {
        const y = 14 + i * rowH;
        return `<text class="tick-label" x="0" y="${y + 3}">${lineName(p.route)}</text>
          <line x1="${x(0)}" x2="${x(p.dist_m.at(-1) ?? 0)}" y1="${y}" y2="${y}" stroke="${routeColor(p.route)}" stroke-width="3" stroke-opacity="0.5"/>
          <text class="tick-label" x="${x(p.dist_m.at(-1) ?? 0)}" y="${y + 14}" text-anchor="end">to ${escapeHtml(p.dir_name)}, ${(p.dist_m.at(-1)! / 1000).toFixed(1)} km</text>
          ${p.stations
            .map((id, j) => {
              const r = byKey.get(`${m}:${id}`);
              const fill = r ? netColor(r.net, span) : 'var(--axis)';
              return `<circle data-k="${m}:${id}" cx="${x(p.dist_m[j])}" cy="${y}" r="5" fill="${fill}" stroke="var(--surface)" class="${r ? 'cursor-pointer' : ''}"/>`;
            })
            .join('')}`;
      })
      .join('')}</svg>`;
  hover(
    el,
    (t) => {
      const k = t.dataset.k ?? '';
      const r = byKey.get(k);
      const nm = escapeHtml(NAMES.get(k.split(':')[1]) ?? k);
      return r
        ? `<b>${nm}</b><br/>${fmtHours(r.net)} h/day, rank ${r.rank}`
        : `<b>${nm}</b><br/>end of the line`;
    },
    (t) => byKey.has(t.dataset.k ?? '') && onOpen(t.dataset.k ?? ''),
  );
}

/** Stops worth closing and their total, across stop cost and walk weight. */
export function networkGrid(parent: HTMLElement, ctx: Ctx): void {
  const el = figure(parent, COPY.network.grid, COPY.network.gridBody);
  const stations = ctx.scored.map((r) => r.station);
  const net = (s: Station, c: Cost): number => {
    const saved =
      c.source === 'flat'
        ? (s.through * c.flatS) / 3600
        : s.dwell_h + s.accel_h;
    return saved - (s.walk_mh / c.walkSpeed) * c.walkWeight;
  };
  el.innerHTML = heatmapHtml(
    (c) => {
      const pos = stations.map((s) => net(s, c)).filter((v) => v > 0);
      const total = pos.reduce((a, b) => a + b, 0);
      return {
        value: pos.length,
        text: `${pos.length}<span class="hidden text-[9px] opacity-70 sm:block">${fmtTick(total)} h</span>`,
      };
    },
    ctx.cost.walkSpeed,
    ctx.cost.walkWeight,
  );
}

/** Median dwell vs riders getting on or off per train, per platform and direction. */
export function dwellScatter(parent: HTMLElement, ctx: Ctx): void {
  const pts = modesIn(ctx).flatMap((m) =>
    MODES[m].platforms
      .map((p) => ({
        route: p.route,
        name: NAMES.get(p.station) ?? p.station,
        x: p.riders_per_train ?? 0,
        y: p.dwell_s[p.bands.indexOf('all')] ?? 0,
      }))
      .filter((p) => p.x > 0 && p.y > 0),
  );
  if (!pts.length) {
    return;
  }
  const el = figure(parent, COPY.network.scatter, COPY.network.scatterBody);
  // Least squares dwell = a + b * riders
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const b =
    pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) /
    pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const a = my - b * mx;
  const W = widthOf(el);
  const H = 220;
  const pad = { l: 34, r: 8, t: 8, b: 30 };
  const xMax = max(pts, (p) => p.x) ?? 1;
  const yMax = (max(pts, (p) => p.y) ?? 1) * 1.05;
  const xs = scaleLog()
    .domain([0.3, xMax * 1.1])
    .range([pad.l, W - pad.r])
    .clamp(true);
  const y = (v: number): number => pad.t + (H - pad.t - pad.b) * (1 - v / yMax);
  const fit = Array.from({ length: 40 }, (_, i) => {
    const xv = 0.3 * Math.pow((xMax * 1.1) / 0.3, i / 39);
    return `${i ? 'L' : 'M'}${xs(xv)},${y(a + b * xv)}`;
  }).join('');
  const routes = [...new Set(pts.map((p) => p.route))];
  el.innerHTML =
    legend(
      routes.map((r) => [routeColor(r), lineName(r)] as [string, string]),
    ) +
    `<svg viewBox="0 0 ${W} ${H}" class="w-full">
      ${[0, 20, 40, 60, 80, 100, 120]
        .filter((t) => t <= yMax)
        .map(
          (t) =>
            `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)"/><text class="tick-label" x="${pad.l - 4}" y="${y(t) + 3}" text-anchor="end">${t}</text>`,
        )
        .join('')}
      ${[0.5, 1, 2, 5, 10, 20, 50, 100]
        .filter((t) => t <= xMax * 1.1)
        .map(
          (t) =>
            `<text class="tick-label" x="${xs(t)}" y="${H - 16}" text-anchor="middle">${t}</text>`,
        )
        .join('')}
      <text class="tick-label" x="${(W + pad.l) / 2}" y="${H - 2}" text-anchor="middle">${COPY.network.scatterX}</text>
      ${pts.map((p, i) => `<circle data-k="${i}" cx="${xs(p.x)}" cy="${y(p.y)}" r="3.5" fill="${routeColor(p.route)}" fill-opacity="0.65"/>`).join('')}
      <path d="${fit}" fill="none" stroke="var(--foreground)" stroke-width="1.5" stroke-dasharray="4 3"/>
      <text class="tick-label" x="${W - pad.r}" y="${pad.t + 10}" text-anchor="end" style="fill:var(--foreground)">${COPY.network.scatterFit(a, b)}</text>
    </svg>`;
  hover(el, (t) => {
    const p = pts[Number(t.dataset.k)];
    return p
      ? `<b>${escapeHtml(p.name)}</b> (${lineName(p.route)})<br/>${p.x.toFixed(1)} riders per train, ${Math.round(p.y)} s median dwell`
      : null;
  });
}

/** Distribution of LAMP dwell per route, as small multiples. */
export function dwellHistogram(parent: HTMLElement, ctx: Ctx): void {
  const el = figure(parent, COPY.network.hist, COPY.network.histBody);
  const W = widthOf(el);
  const rowH = 46;
  const pad = 70;
  const series = modesIn(ctx).flatMap((m) =>
    Object.entries(MODES[m].dwell_hist).map(([route, counts]) => ({
      route,
      counts,
      bin: MODES[m].dwell_bin_s,
    })),
  );
  const nBins = max(series, (s) => s.counts.length) ?? 1;
  const bin = series[0]?.bin ?? 5;
  const x = (s: number): number => pad + ((W - pad - 8) * s) / (nBins * bin);
  const H = series.length * rowH + 20;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="w-full">${series
    .map((s, i) => {
      const total = s.counts.reduce((a, b) => a + b, 0) || 1;
      const peak = max(s.counts) ?? 1;
      const base = 8 + (i + 1) * rowH - 6;
      const h = rowH - 10;
      // Median from the cumulative counts
      let acc = 0;
      const mi = s.counts.findIndex((c) => (acc += c) >= total / 2);
      const med = (mi + 0.5) * s.bin;
      const area =
        `M${x(0)},${base}` +
        s.counts
          .map(
            (c, j) =>
              `L${x(j * s.bin)},${base - (h * c) / peak}L${x((j + 1) * s.bin)},${base - (h * c) / peak}`,
          )
          .join('') +
        `L${x(s.counts.length * s.bin)},${base}Z`;
      return `<text class="tick-label" x="0" y="${base - 4}">${lineName(s.route)}</text>
        <path d="${area}" fill="${routeColor(s.route)}" fill-opacity="0.35" stroke="${routeColor(s.route)}" stroke-width="1"/>
        <line x1="${x(med)}" x2="${x(med)}" y1="${base - h}" y2="${base}" stroke="var(--foreground)"/>
        <text class="tick-label" x="${x(med) + 4}" y="${base - h + 8}" style="fill:var(--foreground)">${Math.round(med)} s</text>`;
    })
    .join('')}
    ${[0, 30, 60, 90, 120, 150, 180]
      .filter((t) => t <= nBins * bin)
      .map(
        (t) =>
          `<text class="tick-label" x="${x(t)}" y="${H - 4}" text-anchor="middle">${t}s</text>`,
      )
      .join('')}
  </svg>`;
}

/** Daily riders using each stop vs riding through it, log-log. */
export function usage(
  parent: HTMLElement,
  ctx: Ctx,
  onOpen: (key: string) => void,
): void {
  const el = figure(parent, COPY.network.usage, COPY.network.usageBody);
  const W = widthOf(el);
  const H = 240;
  const pad = { l: 40, r: 8, t: 8, b: 30 };
  const pts = ctx.scored.map((r) => ({ r, ...dailyRiders(r.station) }));
  const xMax = max(pts, (p) => p.through) ?? 10;
  const yMax = max(pts, (p) => p.used) ?? 10;
  const xs = scaleLog()
    .domain([100, xMax * 1.2])
    .range([pad.l, W - pad.r])
    .clamp(true);
  const ys = scaleLog()
    .domain([30, yMax * 1.2])
    .range([H - pad.b, pad.t])
    .clamp(true);
  const top = new Set(ctx.scored.slice(0, 5).map((r) => r.station.key));
  const ticks = [100, 300, 1000, 3000, 10000, 30000, 100000];
  el.innerHTML =
    legend([
      ['var(--cut)', 'closing saves time'],
      ['var(--keep)', 'closing costs time'],
    ]) +
    `<svg viewBox="0 0 ${W} ${H}" class="w-full">
      ${ticks
        .filter((t) => t <= xMax * 1.2)
        .map(
          (t) =>
            `<line x1="${xs(t)}" x2="${xs(t)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--border)"/><text class="tick-label" x="${xs(t)}" y="${H - 16}" text-anchor="middle">${fmtTick(t).replace('+', '')}</text>`,
        )
        .join('')}
      ${[30, 100, 300, 1000, 3000, 10000, 30000]
        .filter((t) => t <= yMax * 1.2)
        .map(
          (t) =>
            `<line x1="${pad.l}" x2="${W - pad.r}" y1="${ys(t)}" y2="${ys(t)}" stroke="var(--border)"/><text class="tick-label" x="${pad.l - 4}" y="${ys(t) + 3}" text-anchor="end">${fmtTick(t).replace('+', '')}</text>`,
        )
        .join('')}
      <text class="tick-label" x="${(W + pad.l) / 2}" y="${H - 2}" text-anchor="middle">${COPY.network.usageX}</text>
      ${pts.map((p) => `<circle data-k="${p.r.station.key}" cx="${xs(Math.max(p.through, 100))}" cy="${ys(Math.max(p.used, 30))}" r="4" fill="${p.r.net > 0 ? 'var(--cut)' : 'var(--keep)'}" fill-opacity="0.7" class="cursor-pointer"/>`).join('')}
      ${pts
        .filter((p) => top.has(p.r.station.key))
        .map(
          (p) =>
            `<text class="tick-label" x="${xs(Math.max(p.through, 100)) + 6}" y="${ys(Math.max(p.used, 30)) + 3}" style="fill:var(--foreground)">${escapeHtml(p.r.station.name)}</text>`,
        )
        .join('')}
    </svg><p class="text-[10px] text-muted">${COPY.network.usageY} (vertical axis)</p>`;
  const byKey = new Map(pts.map((p) => [p.r.station.key, p]));
  hover(
    el,
    (t) => {
      const p = byKey.get(t.dataset.k ?? '');
      return p
        ? `<b>${escapeHtml(p.r.station.name)}</b><br/>${fmtInt(p.through)} through, ${fmtInt(p.used)} on or off<br/>${fmtHours(p.r.net)} h/day`
        : null;
    },
    (t) => onOpen(t.dataset.k ?? ''),
  );
}

const MBTA_STOPS = ['place-kntst', 'place-bndhl', 'place-fbkst'];

/** Kent Street, Brandon Hall and Fairbanks: our per-rider stop cost vs MBTA's figure. */
export function mbtaCompare(parent: HTMLElement, ctx: Ctx): void {
  if (!modesIn(ctx).includes('green')) {
    return;
  }
  const el = figure(parent, COPY.network.mbta, COPY.network.mbtaBody);
  const plats = MODES.green.platforms.filter((p) =>
    MBTA_STOPS.includes(p.station),
  );
  const costOf = (dw: number, ac: number): number =>
    ctx.cost.source === 'flat'
      ? ctx.cost.flatS
      : ctx.cost.source === 'dwell'
        ? dw
        : dw + ac;
  const rows = plats.map((p) => {
    const i = p.bands.indexOf('all');
    const dirName =
      MODES.green.patterns.find((q) => q.route === p.route && q.dir === p.dir)
        ?.dir_name ?? p.dir;
    return {
      label: `${NAMES.get(p.station)} ${dirName}bound`,
      v: costOf(p.dwell_s[i] ?? 0, p.accel_s[i] ?? 0),
    };
  });
  const kent = rows.filter((r) => r.label.startsWith('Kent'));
  const bhfb = rows.filter((r) => !r.label.startsWith('Kent'));
  const mean = (xs: { v: number }[]): number =>
    xs.reduce((a, b) => a + b.v, 0) / Math.max(1, xs.length);
  const combined = mean(kent) + mean(bhfb);
  const top =
    Math.max(combined, 2 * MBTA_IMPLIED_S[1], ...rows.map((r) => r.v)) * 1.05;
  const pct = (v: number): number => (100 * v) / top;
  const bar = (
    label: string,
    v: number,
    band: [number, number],
    bold = false,
  ): string =>
    `<div class="grid grid-cols-[10rem_1fr_3rem] items-center gap-3 text-xs">
      <span class="${bold ? 'font-semibold' : 'text-secondary'}">${escapeHtml(label)}</span>
      <div class="relative h-5">
        <div class="absolute inset-y-0 rounded-sm bg-keep/25" style="left:${pct(band[0])}%;width:${pct(band[1] - band[0])}%"></div>
        <div class="absolute inset-y-1.5 left-0 rounded-sm bg-fg" style="width:${pct(v)}%"></div>
      </div>
      <span class="text-right tabular-nums">${Math.round(v)} s</span></div>`;
  el.innerHTML =
    legend([
      ['var(--foreground)', 'our stop cost per passing rider'],
      [
        'color-mix(in srgb, var(--keep) 25%, transparent)',
        COPY.network.mbtaBand,
      ],
    ]) +
    `<div class="space-y-2">${rows.map((r) => bar(r.label, r.v, MBTA_IMPLIED_S)).join('')}
      ${bar('Kent + one of the pair', combined, [2 * MBTA_IMPLIED_S[0], 2 * MBTA_IMPLIED_S[1]], true)}
    </div>`;
}
