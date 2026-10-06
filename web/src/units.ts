/** Rider-hours restated as Boston things: hours x wage / price. */

import { UNIT_NAMES } from './content/copy';

/** Rough Boston median hourly wage, $. */
export const WAGE = 32;

/** A click this long after the last one returns to hours. */
const PAUSE_MS = 3000;

export type UnitId = keyof typeof UNIT_NAMES;

export interface Unit {
  id: UnitId;
  name: string;
  /** Rough price in $. */
  price: number;
  icon: (cls: string) => string;
}

const svg =
  (body: string) =>
  (cls: string): string =>
    `<svg viewBox="0 0 24 24" class="${cls}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const DIE = svg(
  '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><g fill="currentColor" stroke="none"><circle cx="8.3" cy="8.3" r="1.4"/><circle cx="15.7" cy="8.3" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="8.3" cy="15.7" r="1.4"/><circle cx="15.7" cy="15.7" r="1.4"/></g>',
);

const ICONS: Record<UnitId, (cls: string) => string> = {
  lobster: svg(
    '<path d="M10 8.2c0-1.2 4-1.2 4 0l.4 5.3H9.6ZM9.8 13.5h4.4l-.4 2h-3.6ZM10.3 15.5h3.4l-.3 1.8h-2.8ZM10.6 17.3 8.6 21h6.8l-2-3.7M10 9.2 7.6 7.4M14 9.2l2.4-1.8M7.6 7.4C5.5 7.4 4 6 4 4c0-1.2.5-2 1-2.5.2 1.3.8 2 1.6 2.2L6.2 2.4c1.3.2 2.2 1.4 2.2 2.8 0 1-.3 1.6-.8 2.2ZM16.4 7.4C18.5 7.4 20 6 20 4c0-1.2-.5-2-1-2.5-.2 1.3-.8 2-1.6 2.2l.4-1.3c-1.3.2-2.2 1.4-2.2 2.8 0 1 .3 1.6.8 2.2ZM9.8 10.5l-3 1.6M9.7 12.2l-3 2M14.2 10.5l3 1.6M14.3 12.2l3 2"/>',
  ),
  roastBeef: svg(
    '<path d="M3 11a9 5 0 0 1 18 0Z"/><path d="M3 14c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0"/><rect x="3" y="17" width="18" height="3" rx="1.5"/>',
  ),
  chowder: svg(
    '<path d="M3 11h18c0 4.5-4 8-9 8s-9-3.5-9-8Z"/><path d="M9 3.5c-1 1 1 2 0 3.5M13 3.5c-1 1 1 2 0 3.5M17 6l3-3"/>',
  ),
  barPizza: svg(
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.5"/><circle cx="10" cy="10" r="1"/><circle cx="14.5" cy="11" r="1"/><circle cx="11" cy="14.5" r="1"/>',
  ),
  creamPie: svg(
    '<path d="M4 10h16v8H4Z"/><path d="M4 12.5c1 0 1.5 1.5 2.5 1.5S8 12.5 9 12.5s1.5 1.5 2.5 1.5 1.5-1.5 2.5-1.5 1.5 1.5 2.5 1.5 1.5-1.5 3.5-1.5M4 16h16M2 21h20"/>',
  ),
  donut: svg(
    '<ellipse cx="12" cy="10.5" rx="9" ry="5.5"/><path d="M3 10.5v2.5c0 3 4 5.5 9 5.5s9-2.5 9-5.5v-2.5"/><ellipse cx="12" cy="10" rx="2.8" ry="1.2"/><path d="M4.6 12.6c1 .9 1.8.2 2.8.9s1.7.6 2.7.9 1.9-.3 2.9-.1 1.9-.5 2.9-.6 1.6-.6 3.5-1.1M7.5 8.6l1-.4M15.8 8l.9.6M15.8 11.6l1-.3"/>',
  ),
  coffee: svg(
    '<rect x="5" y="3" width="14" height="3.5" rx="1"/><path d="M6 6.5h12L16.5 21h-9ZM6.6 11h10.8M7.1 15.5h9.8"/>',
  ),
  socks: svg(
    '<g fill="#bd3039" stroke="var(--background)" stroke-width="1.4"><path transform="translate(-3.5 0)" d="M7 2h6v9l4.8 4.5a3 3 0 0 1-4.1 4.4l-5.4-5A4 4 0 0 1 7 11.9Z"/><path transform="translate(2.5 1.5)" d="M7 2h6v9l4.8 4.5a3 3 0 0 1-4.1 4.4l-5.4-5A4 4 0 0 1 7 11.9Z"/></g>',
  ),
  ticket: svg(
    '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 11v2M13 17v2"/>',
  ),
  charlie: svg(
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7.5 10c1 1 1 3 0 4M10.5 8.5c2 2 2 5 0 7M14 15h4"/>',
  ),
  syrup: svg(
    '<path d="m12 2 1.5 3 1.5-.5-.5 4.5L17 6.5l.5 1.5 3-.5-1 3 1.5 1-5 4 .5 1.5-4.5-.5-4.5.5.5-1.5-5-4 1.5-1-1-3 3 .5.5-1.5 2.5 2.5L9 4.5l1.5.5Z"/><path d="M12 16.5V22"/>',
  ),
  molasses: svg(
    '<rect x="7" y="3" width="10" height="3" rx="1"/><path d="M6 6h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z"/><path d="M6 10c2 0 2 2 3 2s1-2 3-2 2 3 3 3 1-3 3-3"/>',
  ),
  iceCream: svg(
    '<path d="M5 12h14l-2 9H7Z"/><path d="M6 12a6 6 0 0 1 12 0M12 6V4"/>',
  ),
  brick: svg(
    '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19"/>',
  ),
  dirt: svg(
    '<path d="M3 20c1.5-4 5-6 9-6s7.5 2 9 6Z"/><path d="M13 2h4M15 2v8M12.5 10h5v2.5a2.5 2.5 0 0 1-5 0Z"/>',
  ),
};

const PRICES: Record<UnitId, number> = {
  lobster: 20,
  roastBeef: 13,
  chowder: 9,
  barPizza: 16,
  creamPie: 25,
  donut: 1.75,
  coffee: 3,
  socks: 15,
  ticket: 9,
  charlie: 2.4,
  syrup: 70,
  molasses: 35,
  iceCream: 6,
  brick: 250,
  dirt: 40,
};

const UNITS: Unit[] = (Object.keys(UNIT_NAMES) as UnitId[]).map((id) => ({
  id,
  name: UNIT_NAMES[id],
  price: PRICES[id],
  icon: ICONS[id],
}));

/** Things per rider-hour; 1 for hours. */
export const unitFactor = (u: Unit | null): number => (u ? WAGE / u.price : 1);

let lastClick = -Infinity;

/** Unit after a click: another random thing, or hours after a pause. */
export function nextUnit(current: Unit | null, now: number): Unit | null {
  const idle = now - lastClick;
  lastClick = now;
  if (current && idle > PAUSE_MS) {
    return null;
  }
  const pool = UNITS.filter((u) => u !== current);
  return pool[Math.floor(Math.random() * pool.length)];
}
