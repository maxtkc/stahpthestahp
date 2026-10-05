import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './style.css';
import { BY_KEY } from './data';
import type { Ctx } from './exhibits/common';
import { fmtHours } from './format';
import { score, type Settings } from './model';
import { netScale, type NetScale } from './scale';
import { getState, setState, subscribe } from './store';
import { renderDetail } from './ui/detail';
import { renderLearn } from './ui/learn';
import { createList } from './ui/list';
import { mountShell } from './ui/shell';
import { MODE_LABELS } from './content/copy';
import { escapeHtml } from './format';

const shell = mountShell(document.getElementById('app') as HTMLElement);
const toggle = (key: string): void =>
  setState({ open: getState().open === key ? null : key });
const list = createList(shell.axis, shell.list, toggle);
const openFromLearn = (key: string): void => {
  setState({ view: 'list', open: key });
  requestAnimationFrame(() =>
    list.detail()?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  );
};

const scales = new Map<string, NetScale>();
function scaleFor(mode: Settings['mode']): NetScale {
  let s = scales.get(mode);
  if (!s) {
    s = netScale(mode);
    scales.set(mode, s);
  }
  return s;
}

function lede(ctx: Ctx): string {
  const positive = ctx.scored.filter((r) => r.net > 0);
  const best = ctx.scored[0];
  const where =
    ctx.settings.mode === 'all'
      ? 'MBTA subway and Green Line'
      : MODE_LABELS[ctx.settings.mode];
  return `We weighed every ${where} stop: the seconds it costs everyone riding through against the extra walk for everyone who gets on or off there. At these settings, <b class="text-fg">${positive.length} of ${ctx.scored.length}</b> stops would save riders time if they closed, led by <b class="text-fg">${escapeHtml(best.station.name)}</b> at <b class="text-fg">${fmtHours(best.net)} rider-hours</b> every weekday, even counting a minute of walking as ${ctx.settings.walkWeight.toFixed(2).replace(/\.?0+$/, '')} on the train.`;
}

let renderedOpen: string | null = null;
let renderedKey = '';
let wasLearn = false;

function render(s: Settings): void {
  const cost = {
    source: s.source,
    flatS: s.flatS,
    walkWeight: s.walkWeight,
    walkSpeed: s.walkSpeed,
  };
  const scored = score(s.mode, cost);
  const ctx: Ctx = { settings: s, cost, scored };
  const scale = scaleFor(s.mode);
  shell.sync(s);
  shell.lede.innerHTML = lede(ctx);

  const learn = s.view === 'learn';
  shell.learn.hidden = !learn;
  shell.lede.hidden = learn;
  shell.modes.hidden = learn;
  shell.controls.hidden = learn;
  shell.listWrap.hidden = learn;
  if (learn) {
    renderLearn(shell.learn, ctx, scale, openFromLearn);
    if (!wasLearn) {
      window.scrollTo({ top: 0 });
    }
    wasLearn = true;
    return;
  }
  wasLearn = false;

  const open = s.open && BY_KEY.has(s.open) ? s.open : null;
  list.render(scored, scale, shell.search.value, s.sortDesc, open, cost);
  const el = list.detail();
  // Rebuild the detail only when the stop or a setting changes
  const key = JSON.stringify([open, cost, s.mode, el ? el.clientWidth : 0]);
  if (el && open && (open !== renderedOpen || key !== renderedKey)) {
    renderDetail(el, BY_KEY.get(open)!, ctx, () => setState({ open: null }));
  }
  renderedOpen = open;
  renderedKey = key;
}

subscribe((s) => render(s));
shell.search.addEventListener('input', () => render(getState()));
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    renderedKey = '';
    render(getState());
  }, 150);
});
render(getState());
