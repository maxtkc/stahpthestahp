import { COPY } from '../content/copy';
import type { Station } from '../data';
import { escapeHtml, fmtHours } from '../format';
import type { Ctx } from '../exhibits/common';
import { stopVsSkip } from '../exhibits/stop-vs-skip';
import {
  corridor,
  costBands,
  ledger,
  neighbourRiders,
  ridersByHour,
  stationGrid,
} from '../exhibits/station';
import { bullets } from '../routes';

/** Fill el with the per-stop exhibits for s. */
export function renderDetail(
  el: HTMLElement,
  s: Station,
  ctx: Ctx,
  onClose: () => void,
): void {
  const r = ctx.scored.find((x) => x.station.key === s.key);
  const flags = [
    s.flags.includes('hub') ? COPY.flags.hub : '',
    s.flags.includes('accessible')
      ? COPY.flags.accessible
      : COPY.flags.notAccessible,
  ].filter(Boolean);
  el.innerHTML = `<div class="my-2 rounded-lg border border-line bg-surface p-4 sm:p-5">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold tracking-tight">${escapeHtml(s.name)}${bullets(s.routes)}</h2>
        <p class="mt-0.5 text-xs text-muted">Rank ${r?.rank ?? '-'} of ${ctx.scored.length}, ${fmtHours(r?.net ?? 0)} hours per weekday. ${flags.join(', ')}.</p>
      </div>
      <button data-close class="h-8 shrink-0 rounded-lg border border-line px-3 text-xs hover:border-secondary">${COPY.detail.close}</button>
    </div>
    <div data-a></div>
    <div class="grid gap-x-8 md:grid-cols-2">
      <div data-l></div><div data-r></div>
    </div>
  </div>`;
  (el.querySelector('[data-close]') as HTMLElement).addEventListener(
    'click',
    (e) => {
      e.stopPropagation();
      onClose();
    },
  );
  const a = el.querySelector('[data-a]') as HTMLElement;
  const left = el.querySelector('[data-l]') as HTMLElement;
  const right = el.querySelector('[data-r]') as HTMLElement;
  stopVsSkip(a, s, ctx);
  ledger(left, s, ctx);
  neighbourRiders(left, s);
  corridor(left, s, ctx);
  stationGrid(right, s, ctx);
  costBands(right, s, ctx);
  ridersByHour(right, s);
}
