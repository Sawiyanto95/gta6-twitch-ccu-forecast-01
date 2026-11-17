# Launch Curve Forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Sawiyanto95/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Sawiyanto95/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

An offline, deterministic forecast of GTA VI's release-day Twitch audience, expressed as five quantiles for each UTC hour from 2 through 24.

The model learns hourly log viewer ratios to each comparable launch's first-hour print. It weights launches by first-hour size and the preceding 1-, 3-, and 6-hour audience trajectory, and applies a small bounded size adjustment. Curves remain aligned to the UTC release day to preserve audience cycles during rolling local-midnight unlocks. A Gaussian mixture smooths the weighted launch curves into quantiles, retaining hour-specific dispersion and asymmetry. Uncertainty widens for first-hour sizes outside the comparable range. Missing observations are omitted; the GTA VI pre-release category is excluded automatically because it has no release-day print.

The entry uses only Node's standard library, supplied case data, and fixed constants. It uses no network, wall clock, randomness, dependencies, or installed model. Historical timestamps are parsed solely for series alignment.

## Run it

Requires Node 22 with the competition's TypeScript entrypoint support.

```sh
node main.ts
```

By default this reads `/input/*.in` and writes matching `/output/*.out` files. To use the kit locally:

```sh
MAKEFUN_INPUT_DIR=../gta6-twitch-ccu-forecast-01-kit/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

## Local validation

```sh
node validation/validate.mjs ../gta6-twitch-ccu-forecast-01-kit
```

The separate validation utility constructs causal leave-one-launch-out inputs from each practice case's comparables and executes both this entry and the unmodified kit starter on those same inputs. It also runs each practice case twice in isolation, validates every output field and range, compares bytes, and measures process runtime. It uses temporary directories and removes them afterward.

Comparable cross-validation mean log pinball loss: **0.387513**, versus **0.929650** for the starter, a **58.3% reduction**. The 90% interval coverage is **90.4%**. For launches with at least 20,000 viewers in hour 1, loss is **0.251910**, versus **0.321418** for the starter. All four practice inputs passed shape, bounds, and byte-identical repeat-run checks; measured runtime was **181–211 ms per case**, including startup, on local Node 24.22.1. Node 22 was not installed locally; the entry uses plain JavaScript syntax and Node 22 standard-library APIs.

All four comparable sets are identical: these are 37 distinct held-out launch curves, repeated four times (17,020 scored hour/quantile items total). The kit provides no practice answer keys. These numbers are comparable cross-validation scores, not the sealed four-case practice score. Model settings were compared on these folds; the result is development evidence, not an independent final-performance guarantee. Counts are supplied by the competition kit and attributed there to SullyGnome.com; no historical data is redistributed with this entry.

MIT licensed. Competition submission additionally requires the original recorded build-session transcripts and make.fun run record.

<sub>Entered on [make.fun](https://make.fun/?ref=bc76ffwb&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
