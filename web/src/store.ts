import { readHash, writeHash, type Settings } from './model';

type Listener = (s: Settings, prev: Settings) => void;

let state: Settings = readHash(location.hash);
const listeners: Listener[] = [];

export const getState = (): Settings => state;

export function setState(patch: Partial<Settings>): void {
  const prev = state;
  state = { ...state, ...patch };
  history.replaceState(null, '', writeHash(state) || location.pathname);
  for (const l of listeners) {
    l(state, prev);
  }
}

export function subscribe(l: Listener): void {
  listeners.push(l);
}

window.addEventListener('hashchange', () => setState(readHash(location.hash)));
