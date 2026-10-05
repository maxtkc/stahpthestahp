import { stationsFor, netH, type ModeView } from './model';
import { FLAT_RANGE, WEIGHT_RANGE, SPEED_RANGE } from './model';
import { ticks } from 'd3-array';

// Negative hours shrink on a log scale so the busiest stops fit
const LOG_K = 10;
const neg = (x: number): number => Math.log10(1 + Math.abs(x) / LOG_K);

export interface NetScale {
  /** Position in 0-1 for net hours x. */
  (x: number): number;
  ticks: number[];
  min: number;
  max: number;
}

/**
 * Fixed axis for a mode view: spans the most negative and most positive net
 * hours any setting can give, so trains move when settings change. Zero sits
 * in the middle; the positive half is linear and the negative half is log.
 */
export function netScale(mode: ModeView): NetScale {
  const stations = stationsFor(mode);
  const extremes = [
    {
      source: 'flat' as const,
      flatS: FLAT_RANGE.min,
      walkWeight: WEIGHT_RANGE.max,
      walkSpeed: SPEED_RANGE.min,
    },
    {
      source: 'dwell' as const,
      flatS: 0,
      walkWeight: WEIGHT_RANGE.max,
      walkSpeed: SPEED_RANGE.min,
    },
    {
      source: 'flat' as const,
      flatS: FLAT_RANGE.max,
      walkWeight: WEIGHT_RANGE.min,
      walkSpeed: SPEED_RANGE.max,
    },
    {
      source: 'measured' as const,
      flatS: 0,
      walkWeight: WEIGHT_RANGE.min,
      walkSpeed: SPEED_RANGE.max,
    },
  ];
  let min = -1;
  let max = 1;
  for (const s of stations) {
    for (const c of extremes) {
      const n = netH(s, c);
      min = Math.min(min, n);
      max = Math.max(max, n);
    }
  }
  const nMin = neg(min);
  const f = ((x: number) =>
    x >= 0 ? 0.5 + (0.5 * x) / max : 0.5 - (0.5 * neg(x)) / nMin) as NetScale;
  const negTicks = [-100, -1000, -10000].filter((t) => t >= min);
  const posTicks = ticks(0, max, 3).filter((t) => t > 0);
  f.ticks = [...negTicks.reverse(), 0, ...posTicks];
  f.min = min;
  f.max = max;
  return f;
}
