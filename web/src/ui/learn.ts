import { CAVEATS, COPY, LINKS, SOURCES } from '../content/copy';
import type { Ctx } from '../exhibits/common';
import {
  dwellHistogram,
  dwellScatter,
  mbtaCompare,
  networkGrid,
  strips,
  swarm,
  usage,
} from '../exhibits/network';
import type { NetScale } from '../scale';

const H2 = 'pt-8 text-xl font-semibold tracking-tight';

/** Fill el with the method, network-wide exhibits, caveats and sources. */
export function renderLearn(
  el: HTMLElement,
  ctx: Ctx,
  scale: NetScale,
  onOpen: (key: string) => void,
): void {
  el.innerHTML = `<div class="text-[15px] leading-7 text-secondary">
    <p class="mt-6">${COPY.network.intro}</p>
    <h2 class="${H2} text-fg">${COPY.network.how}</h2>
    ${COPY.network.howBody.map((p) => `<p class="mt-3">${p}</p>`).join('')}
  </div>
  <div data-ex class="mt-4"></div>
  <h2 class="${H2}">${COPY.network.caveats}</h2>
  <p class="mt-2 text-xs text-muted">${COPY.network.caveatsBody}</p>
  <ul class="mt-3 space-y-2 text-sm leading-6 text-secondary">${CAVEATS.map(
    ([tag, t]) =>
      `<li class="grid grid-cols-[2rem_1fr]"><span class="font-mono text-xs leading-6 ${tag === '+' ? 'text-cut' : tag === '?' ? 'text-muted' : 'text-keep'}">[${tag}]</span><span>${t}</span></li>`,
  ).join('')}</ul>
  <h2 class="${H2}">${COPY.network.sources}</h2>
  <ul class="mt-3 space-y-1 text-sm text-secondary">${SOURCES.map(
    ([t, k]) =>
      `<li><a class="link" href="${LINKS[k]}" target="_blank" rel="noopener noreferrer">${t}</a></li>`,
  ).join('')}</ul>`;
  const ex = el.querySelector('[data-ex]') as HTMLElement;
  swarm(ex, ctx, scale, onOpen);
  strips(ex, ctx, onOpen);
  networkGrid(ex, ctx);
  usage(ex, ctx, onOpen);
  dwellScatter(ex, ctx);
  dwellHistogram(ex, ctx);
  mbtaCompare(ex, ctx);
}
