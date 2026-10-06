import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './style.css';
import { BY_KEY } from './data';
import type { Ctx } from './exhibits/common';
import { score, type Settings } from './model';
import { netScale, type NetScale } from './scale';
import { getState, setState, subscribe } from './store';
import { renderDetail } from './ui/detail';
import { renderLearn } from './ui/learn';
import { createList } from './ui/list';
import { mountShell } from './ui/shell';
import { initTheme } from './theme';

const shell = mountShell(document.getElementById('app') as HTMLElement);
initTheme();
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
