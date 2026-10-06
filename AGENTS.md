# AGENTS.md

Ranks MBTA stops by the net weekday rider-hours of removing each one: time
saved by riders passing through, minus extra walking for riders who used it.
Covers the Green Line and the subway (Red, Orange, Blue); other modes plug in
under `modes/`.

## Commands

```bash
uv sync
uv run stahp --help
uv run stahp export           # bake site data into web/src/data/
scripts/check.sh              # ruff, vulture, deptry, pytest, web check (the pre-commit hook)
cd web && pnpm dev            # site at localhost:5173
```

## Architecture

| Module | What it does |
|---|---|
| `cli.py` | The `stahp` command |
| `fetch.py` | `stahp fetch`: GTFS, LAMP OTP and ridership into `data/raw/` with `manifest.json` |
| `stops.py` | `stahp stops`: platforms per typical pattern in route order, distance along the shape, terminal/junction/accessible flags |
| `ridership.py` | `stahp riders`: weekday ons, offs, through and displaced riders per station, route, direction and hour; `by_station` sums routes |
| `stopcost.py` | `stahp cost`: median LAMP dwell plus kinematic accel/decel loss per platform, direction and hour band |
| `walk.py` | `stahp walk`: extra walk per displaced rider from the spacing to the neighbouring stops on a 1-D corridor |
| `score.py` | `stahp rank`: net rider-hours per station (through x stop cost - displaced x extra walk x weight), ranking CSV under `results/` and a stop cost x walk weight grid |
| `skip.py` | `stahp skip`: closing a station by direction and hour band, or skipping alternate trains, vs keeping or closing it outright; per-station verdict CSV and per-hour cells under `results/` |
| `export.py` | `stahp export`: per-mode site JSON (station sums the site rescales, riders by hour, stop cost by band, patterns, dwell histogram) into `web/src/data/` |
| `modes/__init__.py` | `Mode` (route ids, accel/decel rates and other per-mode specifics) and `get_mode()` |
| `modes/green.py` | Green Line specifics |
| `modes/subway.py` | Red, Orange and Blue line specifics |

- Raw downloads live under `data/raw/` (gitignored), cached by the manifest.
- `web/` is the site (Vite, TypeScript, d3, Tailwind v4, no framework). It
  imports `web/src/data/*.json`, which is committed, so CI never needs
  `data/raw/`. Re-run `stahp export` after any model change. All copy and
  external links live in `web/src/content/copy.ts`. Net hours are linear in
  every setting, so `web/src/model.ts` recomputes the ranking in the browser
  from the exported sums. Deployed to stahpthestahp.com on `v*` tags.
- Mode-specific values go in `modes/<mode>.py`, never in shared modules.

## Conventions

- **Commits**: Conventional Commits, enforced by the `commit-msg` hook. Never add
  Co-Authored-By trailers.
- **Logging**: module loggers are named `log`, never `logger`.
- **Plans**: `CURRENT_PLAN.md` (checklist, ticked off as work lands) and
  `OVERALL_PLAN.md` sit at the repo root. They are neither tracked nor
  gitignored: never stage or commit them.
