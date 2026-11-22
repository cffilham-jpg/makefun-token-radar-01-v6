# Launch Observatory v6 — Token Radar

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun)
[![rank](https://make.fun/badge/token-radar-01/cffilham-jpg/makefun-token-radar-01-v6/rank.svg)](https://make.fun)
[![reward](https://make.fun/badge/token-radar-01/cffilham-jpg/makefun-token-radar-01-v6/reward.svg)](https://make.fun)

A token launch radar for the [make.fun](https://make.fun) `token-radar-01` bounty: it reads a sealed snapshot of 758 DeFi protocols, ranks the 198 pre-token ones by the implied value of a token they may one day issue, and shows a reader how to farm each one — with the model's own out-of-sample evidence on the board, not just its claims.

## What it does

- **Value model** — an L1 log-log curve of market cap on TVL, fit on the 98 comparables that already trade, with one shrunk family offset each (k=8): `ln value = 7.114 + 0.523 · ln TVL + family offset`. Refit from the snapshot on every run.
- **Token odds** — a ridge logistic model on age and family (10-fold Brier 0.209 against a 0.245 base rate), so `implied = value × P(token)`.
- **Honest ranges** — every row carries P25–P75 and P10–P90 bands cut from the leave-one-out residuals, and the board reports their walk-forward coverage (58% / 75%).
- **Three out-of-sample tests** — leave-one-out (2.76×), walk-forward (2.35×) and a slug-hash holdout (2.95×), each against a flat-median and curve-only ablation, plus two falsification controls (shuffled market caps, permuted labels) that must not help and do not.
- **Farm economics, corrected** — the hold follows the protocol's age (90/60/30 days), gas is charged on the cheapest of the first three chains at realistic fees, and a FARM verdict needs net above the T-bill hurdle and at least $25 an hour. At $1K: 9 FARM / 102 MARGINAL / 87 SKIP.
- **The ledger** — all 758 protocols accounted for: 198 ranked, 416 already trading, 43 bridges, 43 liquid staking, 42 exchange custody, 11 versioned, 5 wrapped.
- **The board shows its work** — the formula, the scatter of all 98 comparables against the fitted curve, the ablation tables, an integrity strip that checks the rendered table against board.json, and a per-row farm plan inline.

## Run it

Node 22, standard library only — no dependencies, no network.

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

It writes `out/board.json` (198 rows), `out/data.js` (the dashboard's data), `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Two runs on the same snapshot write identical bytes.

## Layout

- `main.ts` — the entrypoint: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the model: the fits, the out-of-sample tests, the controls, the farm economics, the farm plans.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js` (45,767 bytes total). Board, detail view per protocol, method view, live-token view; sortable, filterable, $1K/$10K deposit toggle.
- `screenshots/` — the board, a detail view, a filtered view and the method view.
- `vendor/makefun-board.ts` — the make.fun dossier library, vendored from the kit.

## License

MIT — see [LICENSE](LICENSE).
