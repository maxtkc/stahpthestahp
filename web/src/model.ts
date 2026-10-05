import {
  STATIONS,
  type ModeName,
  type Station,
  type StationData,
} from './data';

export type CostSource = 'measured' | 'dwell' | 'flat';
export type ModeView = ModeName | 'all';
export type View = 'list' | 'learn';

export interface Settings {
  mode: ModeView;
  source: CostSource;
  flatS: number;
  walkWeight: number;
  walkSpeed: number;
  open: string | null;
  view: View;
  sortDesc: boolean;
}

export const DEFAULTS: Settings = {
  mode: 'green',
  source: 'measured',
  flatS: 50,
  walkWeight: 2,
  walkSpeed: 1.3,
  open: null,
  view: 'list',
  sortDesc: true,
};

export const FLAT_RANGE = { min: 20, max: 90, step: 5 };
export const WEIGHT_RANGE = { min: 1, max: 3, step: 0.25 };
export const SPEED_RANGE = { min: 0.9, max: 1.6, step: 0.05 };
/** Per-stop saving implied by MBTA's "30-60 s faster" for two fewer C-branch stops. */
export const MBTA_IMPLIED_S: [number, number] = [15, 30];

export interface Cost {
  source: CostSource;
  flatS: number;
  walkWeight: number;
  walkSpeed: number;
}

/** Rider-hours saved on board per weekday if the stop goes. */
export function savedH(s: StationData, c: Cost): number {
  if (c.source === 'flat') {
    return (s.through * c.flatS) / 3600;
  }
  return c.source === 'dwell' ? s.dwell_h : s.dwell_h + s.accel_h;
}

/** Weighted rider-hours of extra walking per weekday if the stop goes. */
export function walkH(s: StationData, c: Cost): number {
  return (s.walk_mh / c.walkSpeed) * c.walkWeight;
}

export function netH(s: StationData, c: Cost): number {
  return savedH(s, c) - walkH(s, c);
}

/** Seconds a passing rider saves, the through-weighted stop cost. */
export function costPerRiderS(s: StationData, c: Cost): number {
  return s.through > 0 ? (savedH(s, c) * 3600) / s.through : 0;
}

export interface Scored {
  station: Station;
  saved: number;
  walk: number;
  net: number;
  rank: number;
}

export function stationsFor(mode: ModeView): Station[] {
  return mode === 'all' ? STATIONS : STATIONS.filter((s) => s.mode === mode);
}

/** Stations in mode with net hours under c, best removal first. */
export function score(mode: ModeView, c: Cost): Scored[] {
  return stationsFor(mode)
    .map((station) => ({
      station,
      saved: savedH(station, c),
      walk: walkH(station, c),
      net: netH(station, c),
      rank: 0,
    }))
    .sort((a, b) => b.net - a.net)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

const HASH_KEYS: Record<string, keyof Settings> = {
  m: 'mode',
  c: 'source',
  s: 'flatS',
  w: 'walkWeight',
  v: 'walkSpeed',
  open: 'open',
  p: 'view',
};

export function readHash(hash: string): Settings {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out = { ...DEFAULTS };
  const num = (k: string, lo: number, hi: number, d: number): number => {
    const x = Number(p.get(k));
    return p.has(k) && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
  };
  const mode = p.get('m');
  if (mode === 'green' || mode === 'subway' || mode === 'all') {
    out.mode = mode;
  }
  const src = p.get('c');
  if (src === 'measured' || src === 'dwell' || src === 'flat') {
    out.source = src;
  }
  out.flatS = num('s', FLAT_RANGE.min, FLAT_RANGE.max, DEFAULTS.flatS);
  out.walkWeight = num(
    'w',
    WEIGHT_RANGE.min,
    WEIGHT_RANGE.max,
    DEFAULTS.walkWeight,
  );
  out.walkSpeed = num(
    'v',
    SPEED_RANGE.min,
    SPEED_RANGE.max,
    DEFAULTS.walkSpeed,
  );
  out.open = p.get('open');
  if (p.get('p') === 'learn') {
    out.view = 'learn';
  }
  return out;
}

/** Hash for s, leaving out values at their defaults. */
export function writeHash(s: Settings): string {
  const p = new URLSearchParams();
  for (const [k, field] of Object.entries(HASH_KEYS)) {
    const v = s[field];
    if (v !== null && v !== DEFAULTS[field]) {
      p.set(k, String(v));
    }
  }
  const q = p.toString();
  return q ? `#${q}` : '';
}
