/** MBTA line colours and short labels per GTFS route_id. */
const ROUTES: Record<string, { label: string; color: string; text: string }> = {
  'Green-B': { label: 'B', color: '#00843d', text: '#fff' },
  'Green-C': { label: 'C', color: '#00843d', text: '#fff' },
  'Green-D': { label: 'D', color: '#00843d', text: '#fff' },
  'Green-E': { label: 'E', color: '#00843d', text: '#fff' },
  Red: { label: 'RL', color: '#da291c', text: '#fff' },
  Orange: { label: 'OL', color: '#ed8b00', text: '#000' },
  Blue: { label: 'BL', color: '#003da5', text: '#fff' },
};

export function routeColor(route: string): string {
  return ROUTES[route]?.color ?? '#7a7974';
}

/** Inline route bullets. */
export function bullets(routes: string[]): string {
  return routes
    .map((r) => {
      const x = ROUTES[r] ?? { label: r, color: '#7a7974', text: '#fff' };
      return `<span class="bullet" style="background:${x.color};color:${x.text}">${x.label}</span>`;
    })
    .join('');
}

/** Long line name for a route, for legends. */
export function lineName(route: string): string {
  return route.startsWith('Green-') ? `Green ${route.slice(6)}` : route;
}
