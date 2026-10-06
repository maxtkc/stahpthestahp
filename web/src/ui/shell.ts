import {
  COPY,
  LINKS,
  MODE_LABELS,
  SOURCE_HELP,
  SOURCE_LABELS,
} from '../content/copy';
import {
  FLAT_RANGE,
  SPEED_RANGE,
  WEIGHT_RANGE,
  type CostSource,
  type ModeView,
  type Settings,
} from '../model';
import { getState, setState } from '../store';
import { DIE, WAGE, type Unit } from '../units';

export interface Shell {
  lede: HTMLElement;
  learnBtn: HTMLButtonElement;
  modes: HTMLElement;
  controls: HTMLElement;
  learn: HTMLElement;
  listWrap: HTMLElement;
  search: HTMLInputElement;
  axis: HTMLElement;
  list: HTMLOListElement;
  unitBtn: HTMLButtonElement;
  sync: (s: Settings) => void;
  syncUnit: (u: Unit | null) => void;
}

const GEAR =
  '<svg viewBox="0 0 24 24" class="h-[18px] w-[18px]" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>';

const SUN =
  '<svg viewBox="0 0 24 24" class="swap-on h-[18px] w-[18px] fill-current" aria-hidden="true"><path d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"/></svg>';
const MOON =
  '<svg viewBox="0 0 24 24" class="swap-off h-[18px] w-[18px] fill-current" aria-hidden="true"><path d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z"/></svg>';

const BTN =
  'h-10 shrink-0 rounded-lg border border-line bg-surface hover:border-secondary';
const PILL = 'h-8 rounded-full border px-3 text-xs';
const pillClass = (on: boolean): string =>
  `${PILL} ${on ? 'border-fg bg-fg text-bg' : 'border-line bg-surface text-secondary hover:border-secondary'}`;

function slider(
  id: string,
  label: string,
  r: { min: number; max: number; step: number },
): string {
  return `<label class="block text-xs text-secondary" for="${id}">
    <span class="flex justify-between"><span>${label}</span><span id="${id}-v" class="tabular-nums text-fg"></span></span>
    <span class="relative mt-1.5 block">
      <input id="${id}" type="range" min="${r.min}" max="${r.max}" step="${r.step}" />
    </span>
  </label>`;
}

export function mountShell(root: HTMLElement): Shell {
  const modes = (Object.keys(MODE_LABELS) as ModeView[])
    .map(
      (m) =>
        `<button data-mode="${m}" class="${pillClass(false)}">${MODE_LABELS[m]}</button>`,
    )
    .join('');
  const sources = (Object.keys(SOURCE_LABELS) as CostSource[])
    .map(
      (c) =>
        `<button data-source="${c}" class="${pillClass(false)}">${SOURCE_LABELS[c]}</button>`,
    )
    .join('');
  const dwellLinks = COPY.dwellLinks
    .map(
      ([t, k]) =>
        `<a class="link" href="${LINKS[k]}" target="_blank" rel="noopener noreferrer">${t}</a>`,
    )
    .join(' ');

  root.innerHTML = `
  <main class="mx-auto max-w-4xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
    <header class="max-w-2xl">
      <div class="flex items-start justify-between gap-4">
        <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">${COPY.title}</h1>
        <label class="theme-toggle swap ${BTN} flex w-10 cursor-pointer items-center justify-center" title="${COPY.theme}">
          <input type="checkbox" class="theme-controller" value="light" />
          <span class="sr-only">${COPY.theme}</span>
          ${SUN}${MOON}
        </label>
      </div>
      <p id="lede" class="mt-4 text-[15px] leading-7 text-secondary">${COPY.lede}</p>
      <div class="mt-5 flex flex-wrap items-center gap-2">
        <button id="learn-btn" class="${BTN} px-4 text-sm"></button>
        <a class="link px-1 text-sm" href="${LINKS.stopthestop}" target="_blank" rel="noopener noreferrer">${COPY.inspired}</a>
        <div id="modes" class="flex flex-wrap items-center gap-2">
          <span class="mx-1 hidden h-6 w-px bg-line sm:block"></span>
          <div class="flex flex-wrap gap-2" role="group" aria-label="Lines">${modes}</div>
        </div>
      </div>
    </header>

    <div id="controls" class="sticky top-0 z-30 -mx-4 mt-6 bg-bg px-4 py-3 sm:-mx-6 sm:px-6">
      <div class="flex gap-2">
        <input id="search" type="search" placeholder="${COPY.searchPlaceholder}"
          class="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-secondary" />
        <button id="sort" class="${BTN} w-10 text-base"></button>
        <button id="unit" class="${BTN} flex min-w-10 items-center justify-center gap-1.5 px-2.5 text-sm"></button>
        <button id="settings-btn" aria-label="${COPY.settings}" title="${COPY.settings}" aria-expanded="false"
          class="${BTN} flex w-10 items-center justify-center">${GEAR}</button>
      </div>
      <section id="settings" hidden class="mt-3 rounded-lg border border-line bg-surface p-4">
        <fieldset>
          <legend class="mb-1.5 text-xs text-secondary">${COPY.settingsCost}</legend>
          <div class="flex flex-wrap gap-2">${sources}</div>
          <p id="source-help" class="mt-2 text-xs leading-5 text-muted"></p>
        </fieldset>
        <div class="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-3">
          <div id="flat-wrap">${slider('flat', COPY.settingsFlat, FLAT_RANGE)}</div>
          ${slider('weight', COPY.settingsWeight, WEIGHT_RANGE)}
          ${slider('speed', COPY.settingsSpeed, SPEED_RANGE)}
        </div>
        <p class="mt-4 border-t border-line pt-3 text-xs leading-5 text-muted">${COPY.dwellNote} ${dwellLinks}</p>
      </section>
      <div id="axis" class="mt-3"></div>
    </div>

    <section id="learn" hidden class="max-w-2xl"></section>
    <div id="list-wrap"><ol id="list" class="relative mt-1"></ol></div>
  </main>`;

  const $ = <T extends HTMLElement>(id: string): T =>
    root.querySelector(`#${id}`) as T;
  const settingsBtn = $<HTMLButtonElement>('settings-btn');
  const panel = $('settings');
  settingsBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    settingsBtn.setAttribute('aria-expanded', String(!panel.hidden));
    settingsBtn.classList.toggle('border-fg', !panel.hidden);
  });
  root
    .querySelectorAll<HTMLButtonElement>('[data-mode]')
    .forEach((b) =>
      b.addEventListener('click', () =>
        setState({ mode: b.dataset.mode as ModeView, open: null }),
      ),
    );
  root
    .querySelectorAll<HTMLButtonElement>('[data-source]')
    .forEach((b) =>
      b.addEventListener('click', () =>
        setState({ source: b.dataset.source as CostSource }),
      ),
    );
  const flat = $<HTMLInputElement>('flat');
  const weight = $<HTMLInputElement>('weight');
  const speed = $<HTMLInputElement>('speed');
  flat.addEventListener('input', () =>
    setState({ flatS: Number(flat.value), source: 'flat' }),
  );
  weight.addEventListener('input', () =>
    setState({ walkWeight: Number(weight.value) }),
  );
  speed.addEventListener('input', () =>
    setState({ walkSpeed: Number(speed.value) }),
  );

  const learnBtn = $<HTMLButtonElement>('learn-btn');
  learnBtn.addEventListener('click', () =>
    setState({ view: getState().view === 'learn' ? 'list' : 'learn' }),
  );
  const sortBtn = $<HTMLButtonElement>('sort');
  sortBtn.addEventListener('click', () =>
    setState({ sortDesc: !getState().sortDesc }),
  );

  const sync = (s: Settings): void => {
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      b.className = pillClass(b.dataset.mode === s.mode);
    });
    root.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((b) => {
      b.className = pillClass(b.dataset.source === s.source);
    });
    $('source-help').textContent = SOURCE_HELP[s.source];
    $('flat-wrap').style.opacity = s.source === 'flat' ? '1' : '0.5';
    flat.value = String(s.flatS);
    weight.value = String(s.walkWeight);
    speed.value = String(s.walkSpeed);
    $('flat-v').textContent = `${s.flatS} s`;
    $('weight-v').textContent = `${s.walkWeight.toFixed(2)}×`;
    $('speed-v').textContent = `${s.walkSpeed.toFixed(2)} m/s`;
    learnBtn.textContent =
      s.view === 'learn' ? COPY.hideLearnMore : COPY.learnMore;
    const label = s.sortDesc ? COPY.sortBest : COPY.sortWorst;
    sortBtn.textContent = s.sortDesc ? '↓' : '↑';
    sortBtn.title = label;
    sortBtn.setAttribute('aria-label', label);
  };

  const unitBtn = $<HTMLButtonElement>('unit');
  const price = (x: number): string =>
    `$${Number.isInteger(x) ? x : x.toFixed(2)}`;
  const syncUnit = (u: Unit | null): void => {
    const icon = (u ? u.icon : DIE)('h-[18px] w-[18px]');
    unitBtn.innerHTML = `<span class="unit-pop flex">${icon}</span>${u ? `<span class="hidden max-w-48 truncate sm:inline">${u.name}</span>` : ''}`;
    const help = u
      ? COPY.unitHelp(u.name, price(u.price), WAGE)
      : COPY.unitHours;
    unitBtn.title = help;
    unitBtn.setAttribute('aria-label', help);
    unitBtn.classList.toggle('border-fg', u !== null);
  };
  syncUnit(null);

  return {
    lede: $('lede'),
    learnBtn,
    modes: $('modes'),
    controls: $('controls'),
    learn: $('learn'),
    listWrap: $('list-wrap'),
    search: $<HTMLInputElement>('search'),
    axis: $('axis'),
    list: $<HTMLOListElement>('list'),
    unitBtn,
    sync,
    syncUnit,
  };
}
