import green from './data/green.json';
import subway from './data/subway.json';

export interface DirRiders {
  name: string | null;
  ons: number[];
  offs: number[];
  through: number[];
}

export interface StationData {
  id: string;
  name: string;
  routes: string[];
  lat: number;
  lon: number;
  flags: string[];
  through: number;
  displaced: number;
  dwell_h: number;
  accel_h: number;
  walk_mh: number;
  extra_walk_m: number;
  rank: number;
  net_h: number;
  dirs: Record<string, DirRiders>;
}

export interface Platform {
  route: string;
  dir: string;
  station: string;
  bands: string[];
  dwell_s: (number | null)[];
  accel_s: (number | null)[];
  v_in: (number | null)[];
  trains: number | null;
  riders_per_train: number | null;
}

export interface Pattern {
  id: string;
  route: string;
  dir: string;
  dir_name: string;
  stations: string[];
  dist_m: number[];
  terminal: boolean[];
}

export interface ModeData {
  mode: string;
  routes: string[];
  generated: string;
  defaults: { walk_speed_mps: number; walk_weight: number };
  lamp_days: number;
  dwell_bin_s: number;
  ridership_period: string;
  lamp_window: string[];
  gtfs_date: string;
  stations: StationData[];
  platforms: Platform[];
  patterns: Pattern[];
  dwell_hist: Record<string, number[]>;
}

export type ModeName = 'green' | 'subway';
export const MODES: Record<ModeName, ModeData> = {
  green: green as ModeData,
  subway: subway as ModeData,
};

/** A station within one mode; key is unique across modes (Park Street is in both). */
export interface Station extends StationData {
  key: string;
  mode: ModeName;
}

export const STATIONS: Station[] = (Object.keys(MODES) as ModeName[]).flatMap(
  (mode) =>
    MODES[mode].stations.map((s) => ({ ...s, key: `${mode}:${s.id}`, mode })),
);

export const BY_KEY = new Map(STATIONS.map((s) => [s.key, s]));

/** Station names by id across both modes. */
export const NAMES = new Map(STATIONS.map((s) => [s.id, s.name]));

export function platformsOf(s: Station): Platform[] {
  return MODES[s.mode].platforms.filter((p) => p.station === s.id);
}

export interface Neighbours {
  pattern: Pattern;
  prev: { id: string; dist: number };
  here: { id: string; dist: number };
  next: { id: string; dist: number };
}

/** Neighbours of a station on each pattern where it is a through stop. */
export function neighboursOf(s: Station): Neighbours[] {
  const out: Neighbours[] = [];
  for (const p of MODES[s.mode].patterns) {
    const i = p.stations.indexOf(s.id);
    if (i <= 0 || i >= p.stations.length - 1) {
      continue;
    }
    out.push({
      pattern: p,
      prev: { id: p.stations[i - 1], dist: p.dist_m[i - 1] },
      here: { id: s.id, dist: p.dist_m[i] },
      next: { id: p.stations[i + 1], dist: p.dist_m[i + 1] },
    });
  }
  return out;
}

/** Daily ons + offs and through riders, summed over directions. */
export function dailyRiders(s: StationData): { used: number; through: number } {
  let used = 0;
  let through = 0;
  for (const d of Object.values(s.dirs)) {
    used +=
      d.ons.reduce((a, b) => a + b, 0) + d.offs.reduce((a, b) => a + b, 0);
    through += d.through.reduce((a, b) => a + b, 0);
  }
  return { used, through };
}
