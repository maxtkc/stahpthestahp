# stahpthestahp

Ranks MBTA stops by the net weekday rider-hours of removing each one, in the
style of [stopthestop](https://github.com/stopthestop). Time saved by riders
passing through a stop is weighed against extra walking for riders who board
or alight there. Covers the Green Line (`--mode green`, the default) and the
Red, Orange and Blue lines (`--mode subway`).

## Running Locally

```bash
uv sync
uv run stahp fetch
uv run stahp stops             # print the stop table
uv run stahp cost              # print stop cost per platform and hour band
uv run stahp riders            # print weekday riders per station and direction
uv run stahp walk              # print extra walk per displaced rider
uv run stahp rank              # rank stations, write results/green_ranking.csv
uv run stahp --mode subway rank  # same for Red, Orange and Blue
uv run stahp export            # write site data to web/src/data/
```

## Site

```bash
cd web
pnpm install
pnpm dev                       # http://localhost:5173
pnpm build                     # static site in web/dist
```

Published to stahpthestahp.com by `.github/workflows/pages.yml` on `v*` tags.

## Development

```bash
uv tool install prek
prek install                  # commit-msg (Conventional Commits) and check hooks
scripts/check.sh
```

## License

AGPL-3.0-or-later. See [LICENSE.txt](LICENSE.txt) and [REUSE.toml](REUSE.toml).
