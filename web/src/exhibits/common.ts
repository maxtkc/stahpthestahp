import type { Cost, Scored, Settings } from '../model';

export interface Ctx {
  settings: Settings;
  cost: Cost;
  scored: Scored[];
}

/** Exhibit heading, description and an empty chart container, appended to parent. */
export function figure(
  parent: HTMLElement,
  title: string,
  body: string,
): HTMLElement {
  const fig = document.createElement('figure');
  fig.className = 'py-3';
  fig.innerHTML = `<h3 class="text-sm font-semibold">${title}</h3>
    <p class="mt-1 text-xs leading-5 text-secondary">${body}</p>
    <div class="chart mt-3"></div>`;
  parent.append(fig);
  return fig.querySelector('.chart') as HTMLElement;
}

/** Width available to a chart, with a floor for hidden or tiny containers. */
export const widthOf = (el: HTMLElement): number =>
  Math.max(280, el.clientWidth || 600);

/** Diverging colour for net hours: cut (positive) or keep (negative), by strength. */
export function netColor(net: number, span: number): string {
  const t = Math.min(1, Math.abs(net) / Math.max(span, 1e-9));
  const pct = Math.round(20 + 80 * Math.sqrt(t));
  return `color-mix(in srgb, var(${net > 0 ? '--cut' : '--keep'}) ${pct}%, var(--surface))`;
}

export function legend(items: [string, string][]): string {
  return `<div class="mb-2 flex flex-wrap gap-4 text-xs text-secondary">${items
    .map(
      ([c, t]) =>
        `<span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm" style="background:${c}"></span>${t}</span>`,
    )
    .join('')}</div>`;
}
