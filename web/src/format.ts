const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export const fmtInt = (x: number): string => int.format(Math.round(x));

/** Hours with a sign, one decimal under 10. */
export function fmtHours(x: number): string {
  const sign = x > 0 ? '+' : x < 0 ? '−' : '';
  const a = Math.abs(x);
  return `${sign}${a < 10 ? one.format(a) : int.format(Math.round(a))}`;
}

/** Signed count, compact above 10k: +4.2, +860, +18k, +1.3M. */
export function fmtCount(x: number): string {
  const a = Math.abs(x);
  if (a < 10_000) {
    return fmtHours(x);
  }
  const sign = x > 0 ? '+' : '−';
  return a >= 1e6
    ? `${sign}${one.format(a / 1e6)}M`
    : `${sign}${int.format(Math.round(a / 1000))}k`;
}

/** Compact signed hours for axis ticks: +1.2k, -300. */
export function fmtTick(x: number): string {
  const sign = x > 0 ? '+' : x < 0 ? '−' : '';
  const a = Math.abs(x);
  return `${sign}${a >= 1000 ? `${one.format(a / 1000)}k` : int.format(a)}`;
}

export function fmtWalk(m: number, speed: number): string {
  const min = m / speed / 60;
  return `${fmtInt(m)} m, about ${min < 1 ? one.format(min) : int.format(Math.round(min))} min`;
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  );
}
