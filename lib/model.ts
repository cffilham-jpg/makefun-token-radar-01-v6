// Token Radar v6 — the model: one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot can rank (198 rows): the
// 40 watchlist protocols plus every other pre-token protocol that is not a bridge,
// a liquid-staking product, an exchange product, a versioned pool or a wrapped /
// staked product of a token that already trades. A protocol is pre-token when its
// record carries no market cap, no CoinGecko id and no symbol.
//
// Implied value follows only from the snapshot's own figures, in three steps:
//
//   value  = exp(7.116 + 0.522 * ln TVL + family offset)   (L1 log-log curve, IRLS)
//   odds   = logistic(age + family)                        (ridge lambda = 1)
//   implied = value * odds
//
// The curve is fit on the 98 comparable protocols that already trade (market cap
// above zero, TVL above zero, not an exchange, market-cap/TVL between 0.02 and
// 10). Family offsets are the family's mean log residual, shrunk by n/(n+8).
// The odds model is fit on the 485 peers listed at least a year. Both fits are
// refit from the snapshot on every run: no fitted number is hardcoded, so the
// radar re-derives itself on a future snapshot.
//
// Farm economics (v6, corrected): the hold follows the protocol's age (under
// 180 days -> 90, under a year -> 60, else 30), gas is charged on the cheapest
// of the protocol's first three chains at realistic per-transaction fees, and
// the action count grows with the hold (3 + ceil(hold/7)). A row is FARM when
// its net beats the T-bill hurdle and pays at least $25 an hour, MARGINAL when
// its net is positive, else SKIP.
//
// Every number the dashboard prints as evidence — the leave-one-out miss, the
// walk-forward miss, the hash holdout, the falsification controls, the Brier
// scores, the bands — is computed here from the snapshot, not asserted.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The seven families the model groups DefiLlama categories into. */
export const FAMILIES = ['Lending', 'Trading', 'Vaults', 'RWA', 'Staking', 'Infra', 'Other'] as const;
export type Family = (typeof FAMILIES)[number];

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-6';

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** The age the model assumes when a protocol's listing date is unknown. */
export const UNKNOWN_AGE_DAYS = 365;

/** A whole day count from `listedAt` to `asOf`, clamped at zero; the unknown-age default when absent. */
export function ageOf(p: SnapshotProtocol, asOf: string): number {
  if (p.listed_at === null) return UNKNOWN_AGE_DAYS;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${p.listed_at}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return UNKNOWN_AGE_DAYS;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The family of a DefiLlama category, by word-boundary substring rules. The
 * boundaries matter: "Indexes" is not a DEX, and "Onchain Capital Allocator"
 * is a vault, not a chain. Unmatched categories fall to Other.
 */
export function familyOf(category: string | null): Family {
  const c = (category ?? '').toLowerCase();
  if (/\blend/.test(c) || /\bcdp/.test(c) || /collateral/.test(c)) return 'Lending';
  if (/\bdexs?\b/.test(c) || /deriv/.test(c) || /trad/.test(c) || /perp/.test(c) || /option/.test(c) || /prediction/.test(c) || /synthetic/.test(c) || /\botc\b/.test(c)) return 'Trading';
  if (/yield/.test(c) || /vault/.test(c) || /curator/.test(c) || /allocator/.test(c) || /\bfarm/.test(c) || /liquidity manager/.test(c)) return 'Vaults';
  if (/rwa/.test(c) || /stable/.test(c)) return 'RWA';
  if (/stak/.test(c) || /restak/.test(c)) return 'Staking';
  if (/bridge/.test(c) || c === 'chain' || /oracle/.test(c) || /interop/.test(c)) return 'Infra';
  return 'Other';
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A wrapped, staked or staking product of a token that already trades. */
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;
/** A product named for an exchange. */
const EXCHANGE_NAMED = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
/** Categories that are not a protocol waiting on a launch of its own. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/**
 * Whether a protocol is one the board may rank: pre-token, not an exchange, not
 * a bridge or liquid-staking product, not a versioned pool, not a wrapped or
 * staked product, not exchange-named. On this snapshot that is 198 protocols.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_NAMED.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The ledger: every protocol of the snapshot accounted for, in one partition. */
export interface Ledger {
  total: number;
  ranked: number;
  live_token: number;
  bridges: number;
  liquid_staking: number;
  exchange_custody: number;
  versioned: number;
  wrapped: number;
}

/**
 * The 758-protocol ledger. The partition is taken in a fixed order over the
 * pre-token protocols — bridges, liquid staking, exchange custody, versioned,
 * wrapped — and what is left is the ranked board; the protocols that already
 * trade are the live set. The counts sum to the snapshot's total.
 */
export function ledgerOf(snapshot: Snapshot): Ledger {
  const taken = new Set<string>();
  const pre = snapshot.protocols.filter(isPreToken);
  const take = (fn: (p: SnapshotProtocol) => boolean): number => {
    let n = 0;
    for (const p of pre) {
      if (!taken.has(p.slug) && fn(p)) {
        taken.add(p.slug);
        n++;
      }
    }
    return n;
  };
  const bridges = take((p) => p.category === 'Bridge' || p.category === 'Canonical Bridge');
  const liquidStaking = take((p) => p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC');
  const exchangeCustody = take((p) => p.category === 'CEX');
  const versioned = take((p) => VERSIONED.test(p.name));
  const wrapped = take((p) => WRAPPED_WORD.test(p.name));
  const ranked = pre.length - taken.size;
  const liveToken = snapshot.protocols.length - pre.length;
  return {
    total: snapshot.protocols.length,
    ranked,
    live_token: liveToken,
    bridges,
    liquid_staking: liquidStaking,
    exchange_custody: exchangeCustody,
    versioned,
    wrapped,
  };
}

// ---------------------------------------------------------------- value model

/** The comparables: protocols that already trade, with a sane market-cap/TVL ratio. */
export function comparables(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) =>
      (p.mcap_usd ?? 0) > 0 &&
      p.tvl_usd > 0 &&
      p.category !== 'CEX' &&
      p.mcap_usd! / p.tvl_usd >= 0.02 &&
      p.mcap_usd! / p.tvl_usd <= 10,
  );
}

/** A fitted value model: the log-log curve plus one shrunk offset per family. */
export interface ValueFit {
  slope: number;
  intercept: number;
  offsets: Record<Family, number>;
  r2: number;
  n: number;
}

/** Ordinary least squares for y ~ a + b*x. */
function ols(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/** Weighted least squares for y ~ a + b*x. */
function wls(xs: number[], ys: number[], ws: number[]): { slope: number; intercept: number } {
  const sw = ws.reduce((a, b) => a + b, 0);
  const mx = xs.reduce((a, x, i) => a + ws[i]! * x, 0) / sw;
  const my = ys.reduce((a, y, i) => a + ws[i]! * y, 0) / sw;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += ws[i]! * (xs[i]! - mx) * (ys[i]! - my);
    sxx += ws[i]! * (xs[i]! - mx) * (xs[i]! - mx);
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/**
 * The L1 (median) log-log curve by iteratively reweighted least squares:
 * weights 1/max(|residual|, 0.5), from the OLS start, to convergence. The 0.5
 * floor keeps a residual of zero from taking an infinite weight; it is a
 * smoothing floor, not a trim — no comparable is dropped.
 */
export function l1Curve(rows: SnapshotProtocol[]): { slope: number; intercept: number } {
  const xs = rows.map((p) => Math.log(p.tvl_usd));
  const ys = rows.map((p) => Math.log(p.mcap_usd!));
  let { slope, intercept } = ols(xs, ys);
  for (let it = 0; it < 100; it++) {
    const ws = xs.map((x, i) => 1 / Math.max(Math.abs(ys[i]! - (intercept + slope * x)), 0.5));
    const next = wls(xs, ys, ws);
    if (Math.abs(next.slope - slope) < 1e-12 && Math.abs(next.intercept - intercept) < 1e-12) {
      slope = next.slope;
      intercept = next.intercept;
      break;
    }
    slope = next.slope;
    intercept = next.intercept;
  }
  return { slope, intercept };
}

/** The shrinkage constant for family offsets: n/(n+8) of the family's mean residual. */
export const OFFSET_SHRINK_K = 8;

/** Family offsets from a curve's residuals, shrunk toward zero. */
export function familyOffsets(rows: SnapshotProtocol[], slope: number, intercept: number): Record<Family, number> {
  const offsets = {} as Record<Family, number>;
  for (const f of FAMILIES) {
    const res = rows
      .filter((p) => familyOf(p.category) === f)
      .map((p) => Math.log(p.mcap_usd!) - (intercept + slope * Math.log(p.tvl_usd)));
    const n = res.length;
    offsets[f] = n === 0 ? 0 : (n / (n + OFFSET_SHRINK_K)) * (res.reduce((a, b) => a + b, 0) / n);
  }
  return offsets;
}

/** Fit the value model on a set of comparables: curve, offsets, and in-sample R2. */
export function fitValue(rows: SnapshotProtocol[]): ValueFit {
  const { slope, intercept } = l1Curve(rows);
  const offsets = familyOffsets(rows, slope, intercept);
  const fit = { slope, intercept, offsets, r2: 0, n: rows.length };
  const ys = rows.map((p) => Math.log(p.mcap_usd!));
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let ssr = 0;
  let sst = 0;
  for (const p of rows) {
    const r = Math.log(p.mcap_usd!) - Math.log(predictValue(p, fit));
    ssr += r * r;
    sst += (Math.log(p.mcap_usd!) - my) * (Math.log(p.mcap_usd!) - my);
  }
  fit.r2 = 1 - ssr / sst;
  return fit;
}

/** The fitted value of a protocol: curve times its family offset, in dollars. */
export function predictValue(p: SnapshotProtocol, fit: ValueFit): number {
  return Math.exp(fit.intercept + fit.slope * Math.log(p.tvl_usd) + (fit.offsets[familyOf(p.category)] ?? 0));
}

/** The curve-only value: no family offset. */
export function predictCurveOnly(p: SnapshotProtocol, fit: ValueFit): number {
  return Math.exp(fit.intercept + fit.slope * Math.log(p.tvl_usd));
}

/** The flat baseline: the median market-cap/TVL multiple times TVL. */
export function flatMultiple(rows: SnapshotProtocol[]): number {
  const ratios = rows.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)]!;
}

/** A quantile of a sorted array, linearly interpolated. */
export function quantile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** One out-of-sample reading: the median miss, the share within 3x, and the size. */
export interface OosReading {
  miss: number;
  within3: number;
  n: number;
}

/** A reading from log errors: median miss as a multiple, share within a factor of 3. */
export function readingFromErrors(errors: number[]): OosReading {
  const abs = errors.map((e) => Math.abs(e)).sort((a, b) => a - b);
  const median = abs[Math.floor(abs.length / 2)]!;
  return {
    miss: Math.exp(median),
    within3: abs.filter((e) => e <= Math.log(3)).length / abs.length,
    n: abs.length,
  };
}

/** Leave-one-out for the full model, the curve alone, and the flat baseline. */
export function leaveOneOut(rows: SnapshotProtocol[]): { full: OosReading; curve: OosReading; flat: OosReading; logErrors: number[] } {
  const fullErrors: number[] = [];
  const curveErrors: number[] = [];
  const flatErrors: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i);
    const fit = fitValue(train);
    const held = rows[i]!;
    fullErrors.push(Math.log(held.mcap_usd! / predictValue(held, fit)));
    curveErrors.push(Math.log(held.mcap_usd! / predictCurveOnly(held, fit)));
    flatErrors.push(Math.log(held.mcap_usd! / (flatMultiple(train) * held.tvl_usd)));
  }
  return {
    full: readingFromErrors(fullErrors),
    curve: readingFromErrors(curveErrors),
    flat: readingFromErrors(flatErrors),
    logErrors: fullErrors,
  };
}

/** FNV-1a hash of a string, for deterministic splits and folds. */
export function fnv1a(text: string): number {
  let t = 2166136261;
  for (const c of text) t = Math.imul(t ^ c.charCodeAt(0), 16777619);
  return t >>> 0;
}

/** A seeded generator (mulberry32): every shuffle in this file is reproducible. */
export function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A Fisher-Yates shuffle of a copy, driven by a seeded generator. */
export function shuffled<T>(items: readonly T[], rnd: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * The hash holdout: comparables split by slug hash, each half fit and tested on
 * the other. The pooled miss is the size-weighted geometric mean of the two.
 */
export function hashHoldout(rows: SnapshotProtocol[]): {
  aToB: OosReading;
  bToA: OosReading;
  pooled: number;
  curveAtoB: OosReading;
  curveBtoA: OosReading;
  curvePooled: number;
  flatAtoB: number;
  flatBtoA: number;
} {
  const a = rows.filter((p) => fnv1a(p.slug) % 2 === 0);
  const b = rows.filter((p) => fnv1a(p.slug) % 2 === 1);
  const test = (train: SnapshotProtocol[], held: SnapshotProtocol[]): { full: OosReading; curve: OosReading; flatMiss: number } => {
    const fit = fitValue(train);
    const mult = flatMultiple(train);
    const errors = held.map((p) => Math.log(p.mcap_usd! / predictValue(p, fit)));
    const curveErrors = held.map((p) => Math.log(p.mcap_usd! / predictCurveOnly(p, fit)));
    const flatErrors = held.map((p) => Math.log(p.mcap_usd! / (mult * p.tvl_usd)));
    return { full: readingFromErrors(errors), curve: readingFromErrors(curveErrors), flatMiss: readingFromErrors(flatErrors).miss };
  };
  const r1 = test(a, b);
  const r2 = test(b, a);
  const pooled = Math.exp((Math.log(r1.full.miss) * r1.full.n + Math.log(r2.full.miss) * r2.full.n) / (r1.full.n + r2.full.n));
  const curvePooled = Math.exp((Math.log(r1.curve.miss) * r1.curve.n + Math.log(r2.curve.miss) * r2.curve.n) / (r1.curve.n + r2.curve.n));
  return { aToB: r1.full, bToA: r2.full, pooled, curveAtoB: r1.curve, curveBtoA: r2.curve, curvePooled, flatAtoB: r1.flatMiss, flatBtoA: r2.flatMiss };
}

/**
 * The walk-forward test: comparables split at the median listing date, the
 * older half fit and the newer half scored. Undated comparables sit out.
 */
export function walkForwardValue(rows: SnapshotProtocol[]): { full: OosReading; curve: OosReading; flat: OosReading; trainN: number } {
  const dated = rows.filter((p) => p.listed_at !== null);
  const days = dated.map((p) => Date.parse(`${p.listed_at}T00:00:00Z`)).sort((a, b) => a - b);
  const cut = days[Math.floor(days.length / 2)]!;
  const train = dated.filter((p) => Date.parse(`${p.listed_at}T00:00:00Z`) <= cut);
  const test = dated.filter((p) => Date.parse(`${p.listed_at}T00:00:00Z`) > cut);
  const fit = fitValue(train);
  const mult = flatMultiple(train);
  return {
    full: readingFromErrors(test.map((p) => Math.log(p.mcap_usd! / predictValue(p, fit)))),
    curve: readingFromErrors(test.map((p) => Math.log(p.mcap_usd! / predictCurveOnly(p, fit)))),
    flat: readingFromErrors(test.map((p) => Math.log(p.mcap_usd! / (mult * p.tvl_usd)))),
    trainN: train.length,
  };
}

/**
 * The walk-forward coverage of the bands: the share of the newer half whose
 * actual market cap falls inside the fitted band. Honest bands cover about
 * their nominal share; bootstrap bands covered 10-20%.
 */
export function walkForwardCoverage(rows: SnapshotProtocol[], lo50: number, hi50: number, lo80: number, hi80: number): { cover50: number; cover80: number; n: number } {
  const dated = rows.filter((p) => p.listed_at !== null);
  const days = dated.map((p) => Date.parse(`${p.listed_at}T00:00:00Z`)).sort((a, b) => a - b);
  const cut = days[Math.floor(days.length / 2)]!;
  const train = dated.filter((p) => Date.parse(`${p.listed_at}T00:00:00Z`) <= cut);
  const test = dated.filter((p) => Date.parse(`${p.listed_at}T00:00:00Z`) > cut);
  const fit = fitValue(train);
  let in50 = 0;
  let in80 = 0;
  for (const p of test) {
    const pred = predictValue(p, fit);
    const ratio = p.mcap_usd! / pred;
    if (ratio >= lo50 && ratio <= hi50) in50++;
    if (ratio >= lo80 && ratio <= hi80) in80++;
  }
  return { cover50: in50 / test.length, cover80: in80 / test.length, n: test.length };
}

/**
 * The value falsification control: shuffle market caps among the comparables
 * (destroying the TVL-to-value relation), refit, and re-run leave-one-out.
 * A real fit must collapse toward the flat baseline; if the shuffled fit kept
 * the edge, the edge would be an artifact of the procedure.
 */
export function shuffledMcapControl(rows: SnapshotProtocol[]): { full: OosReading; flat: OosReading } {
  const rnd = mulberry32(0xc01a);
  const mcaps = shuffled(rows.map((p) => p.mcap_usd!), rnd);
  const shuffledRows = rows.map((p, i) => ({ ...p, mcap_usd: mcaps[i]! }));
  const loo = leaveOneOut(shuffledRows);
  return { full: loo.full, flat: loo.flat };
}

// ---------------------------------------------------------------- odds model

/** The peers: protocols listed at least a year, token or not. */
export function oddsPeers(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.listed_at !== null && ageOf(p, snapshot.as_of) >= 365);
}

/** Whether a protocol has a token (any of the three token fields is set). */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
}

/** The odds features: intercept, age in years (capped at 6), and six family dummies (Other is the reference). */
export function oddsFeatures(p: SnapshotProtocol, asOf: string): number[] {
  const ageYears = Math.min(ageOf(p, asOf), 2190) / 365;
  const fam = FAMILIES.slice(0, 6).map((f) => (familyOf(p.category) === f ? 1 : 0));
  return [1, ageYears, ...fam];
}

/** A feature builder for the odds model: the full set, or one ablation of it. */
export type OddsFeatureFn = (p: SnapshotProtocol, asOf: string) => number[];

/** Age alone, for the odds ablation: intercept plus age in years. */
export function ageOnlyFeatures(p: SnapshotProtocol, asOf: string): number[] {
  return [1, Math.min(ageOf(p, asOf), 2190) / 365];
}

/** Family alone, for the odds ablation: intercept plus the six family dummies. */
export function famOnlyFeatures(p: SnapshotProtocol, asOf: string): number[] {
  return [1, ...FAMILIES.slice(0, 6).map((f) => (familyOf(p.category) === f ? 1 : 0))];
}

/** Solve a small linear system by Gauss-Jordan elimination with partial pivoting. */
function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let j = 0; j < n; j++) {
    let pivot = j;
    for (let k = j + 1; k < n; k++) if (Math.abs(a[k]![j]!) > Math.abs(a[pivot]![j]!)) pivot = k;
    const tmp = a[j]!;
    a[j] = a[pivot]!;
    a[pivot] = tmp;
    const div = a[j]![j]! || 1e-12;
    for (let k = j; k <= n; k++) a[j]![k]! /= div;
    for (let i = 0; i < n; i++) {
      if (i === j) continue;
      const v = a[i]![j]!;
      for (let k = j; k <= n; k++) a[i]![k]! -= v * a[j]![k]!;
    }
  }
  return a.map((row) => row[n]!);
}

/** The ridge penalty on the logistic fit (the intercept is never penalised). */
export const ODDS_RIDGE = 1;

/**
 * Logistic regression by Newton-Raphson with a ridge penalty: 30 iterations
 * or convergence to 1e-6. The labels come from `labelOf` so the permutation
 * control can refit on shuffled labels with the same code.
 */
export function fitLogit(
  rows: SnapshotProtocol[],
  asOf: string,
  labelOf: (p: SnapshotProtocol) => number = (p) => (hasToken(p) ? 1 : 0),
  featureFn: OddsFeatureFn = oddsFeatures,
): number[] {
  const x = rows.map((p) => featureFn(p, asOf));
  const y = rows.map(labelOf);
  const d = x[0]!.length;
  let beta = Array<number>(d).fill(0);
  for (let it = 0; it < 30; it++) {
    const mu = x.map((r) => sigmoid(r.reduce((acc, v, i) => acc + v * beta[i]!, 0)));
    const grad = Array<number>(d).fill(0);
    const hess = Array.from({ length: d }, () => Array<number>(d).fill(0));
    for (let i = 0; i < x.length; i++) {
      const r = x[i]!;
      const w = Math.max(mu[i]! * (1 - mu[i]!), 1e-6);
      const e = y[i]! - mu[i]!;
      for (let j = 0; j < d; j++) {
        grad[j]! += r[j]! * e;
        for (let k = 0; k < d; k++) hess[j]![k]! += w * r[j]! * r[k]!;
      }
    }
    for (let j = 1; j < d; j++) {
      grad[j]! -= ODDS_RIDGE * beta[j]!;
      hess[j]![j]! += ODDS_RIDGE;
    }
    const step = solveLinear(hess, grad);
    beta = beta.map((b, j) => b + step[j]!);
    if (Math.max(...step.map(Math.abs)) < 1e-6) break;
  }
  return beta;
}

/** The fitted probability that a protocol gets a token, under a fitted beta. */
export function predictOdds(p: SnapshotProtocol, asOf: string, beta: number[], featureFn: OddsFeatureFn = oddsFeatures): number {
  const feats = featureFn(p, asOf);
  return sigmoid(feats.reduce((acc, v, i) => acc + v * beta[i]!, 0));
}

/** The Brier score of a beta on a set of rows. */
function brierOf(
  rows: SnapshotProtocol[],
  asOf: string,
  beta: number[],
  labelOf: (p: SnapshotProtocol) => number = (p) => (hasToken(p) ? 1 : 0),
  featureFn: OddsFeatureFn = oddsFeatures,
): number {
  let sum = 0;
  for (const p of rows) {
    const err = predictOdds(p, asOf, beta, featureFn) - labelOf(p);
    sum += err * err;
  }
  return sum / rows.length;
}

/** Deterministic 10-fold split: peers ordered by slug hash, dealt round-robin. */
function oddsFolds(peers: SnapshotProtocol[]): SnapshotProtocol[][] {
  const ordered = [...peers].sort((a, b) => fnv1a(a.slug) - fnv1a(b.slug));
  return Array.from({ length: 10 }, (_, k) => ordered.filter((_, i) => i % 10 === k));
}

/** 10-fold cross-validated Brier for a label function (real labels by default) and a feature set. */
export function oddsCrossValidated(
  peers: SnapshotProtocol[],
  asOf: string,
  labelOf: (p: SnapshotProtocol) => number = (p) => (hasToken(p) ? 1 : 0),
  featureFn: OddsFeatureFn = oddsFeatures,
): number {
  const folds = oddsFolds(peers);
  let weighted = 0;
  let n = 0;
  for (let k = 0; k < 10; k++) {
    const test = folds[k]!;
    const train = folds.flatMap((f, j) => (j === k ? [] : f));
    const beta = fitLogit(train, asOf, labelOf, featureFn);
    weighted += brierOf(test, asOf, beta, labelOf, featureFn) * test.length;
    n += test.length;
  }
  return weighted / n;
}

/** The walk-forward Brier: fit on peers listed before the median date, score the rest. */
export function oddsWalkForward(peers: SnapshotProtocol[], asOf: string): { brier: number; base: number; trainN: number; testN: number } {
  const days = peers.map((p) => Date.parse(`${p.listed_at}T00:00:00Z`)).sort((a, b) => a - b);
  const cut = days[Math.floor(days.length / 2)]!;
  const train = peers.filter((p) => Date.parse(`${p.listed_at}T00:00:00Z`) <= cut);
  const test = peers.filter((p) => Date.parse(`${p.listed_at}T00:00:00Z`) > cut);
  const trainRate = train.filter(hasToken).length / train.length;
  const beta = fitLogit(train, asOf);
  let base = 0;
  for (const p of test) {
    const err = trainRate - (hasToken(p) ? 1 : 0);
    base += err * err;
  }
  return { brier: brierOf(test, asOf, beta), base: base / test.length, trainN: train.length, testN: test.length };
}

/** Calibration by predicted quintile: mean prediction against the actual token rate. */
export function oddsCalibration(peers: SnapshotProtocol[], asOf: string, beta: number[]): { predicted: number; actual: number; n: number }[] {
  const scored = peers
    .map((p) => ({ pred: predictOdds(p, asOf, beta), y: hasToken(p) ? 1 : 0 }))
    .sort((a, b) => a.pred - b.pred);
  const out: { predicted: number; actual: number; n: number }[] = [];
  for (let k = 0; k < 5; k++) {
    const group = scored.slice(Math.floor((k * scored.length) / 5), Math.floor(((k + 1) * scored.length) / 5));
    out.push({
      predicted: group.reduce((a, x) => a + x.pred, 0) / group.length,
      actual: group.reduce((a, x) => a + x.y, 0) / group.length,
      n: group.length,
    });
  }
  return out;
}

/**
 * The odds falsification control: permute the token labels among the peers
 * (destroying the age-and-family signal), refit, and re-run 10-fold Brier.
 * A real fit must return to the base rate; if the permuted fit kept the edge,
 * the edge would be an artifact of the procedure.
 */
export function permutedLabelControl(peers: SnapshotProtocol[], asOf: string): number {
  const rnd = mulberry32(0x9e37);
  const labels = shuffled(peers.map((p) => (hasToken(p) ? 1 : 0)), rnd);
  const bySlug = new Map(peers.map((p, i) => [p.slug, labels[i]!]));
  return oddsCrossValidated(peers, asOf, (p) => bySlug.get(p.slug)!);
}

// ---------------------------------------------------------------- farm economics

/** The standard deposit the board's verdicts are judged on, in dollars. */
export const STANDARD_DEPOSIT = 1000;
/** The larger deposit the board's toggle offers. */
export const LARGE_DEPOSIT = 10000;
/** The share of the implied value a farmer's slice is assumed to capture. */
export const AIRDROP_SHARE = 0.1;
/** The yield forgone on capital parked in a farm, per year. */
export const FORGONE_APR = 0.04;
/** The risk-free hurdle a farm must beat, per year. */
export const TBILL_APR = 0.043;
/** The hourly pay a FARM verdict must clear. */
export const HOURLY_HURDLE = 25;

/** Realistic per-transaction gas by chain, in dollars (November 2026 fees). */
export const GAS_PER_TX: Record<string, number> = {
  ethereum: 3,
  arbitrum: 0.05,
  base: 0.05,
  optimism: 0.05,
  bsc: 0.1,
  bnb: 0.1,
  binance: 0.1,
  polygon: 0.05,
  solana: 0.02,
  avalanche: 0.1,
  'zksync era': 0.1,
  zksync: 0.1,
  linea: 0.05,
  scroll: 0.05,
  blast: 0.05,
  mode: 0.05,
  mantle: 0.05,
};
/** The per-transaction gas for a chain the table does not name. */
export const GAS_DEFAULT = 0.5;

/** The gas per transaction on a chain, by case-insensitive name. */
export function gasOf(chain: string): number {
  return GAS_PER_TX[chain.toLowerCase()] ?? GAS_DEFAULT;
}

/**
 * How long to hold, from the protocol's age in days. A young protocol needs a
 * long hold before its launch window opens; an old one is likely to launch
 * inside a short window, so the capital is not parked any longer than needed.
 */
export function holdDaysFor(ageDays: number): number {
  if (ageDays < 180) return 90;
  if (ageDays < 365) return 60;
  return 30;
}

/** The cheapest of a protocol's first three chains: the route a farmer would take. */
export function routeChainOf(p: SnapshotProtocol): string {
  const first = [...p.chains.slice(0, 3)].sort((a, b) => gasOf(a) - gasOf(b));
  return first[0] ?? 'its main chain';
}

/** A farm verdict: FARM clears both hurdles, MARGINAL clears zero, SKIP loses money. */
export type Verdict = 'FARM' | 'MARGINAL' | 'SKIP';

/** One row's farm economics at a deposit. */
export interface FarmEconomics {
  deposit: number;
  hold_days: number;
  route_chain: string;
  gas_per_tx: number;
  actions: number;
  gas_usd: number;
  forgone_usd: number;
  slice_usd: number;
  net_usd: number;
  hours: number;
  net_per_hour: number;
  tbill_usd: number;
  verdict: Verdict;
}

/** The farm economics of one implied value at one deposit. */
export function economicsFor(implied: number, tvl: number, p: SnapshotProtocol, asOf: string, deposit: number): FarmEconomics {
  const age = ageOf(p, asOf);
  const hold = holdDaysFor(age);
  const chain = routeChainOf(p);
  const perTx = gasOf(chain);
  const actions = 3 + Math.ceil(hold / 7);
  const gas = actions * perTx;
  const forgone = deposit * FORGONE_APR * (hold / 365);
  const slice = AIRDROP_SHARE * implied * (deposit / tvl);
  const net = slice - gas - forgone;
  const hours = (30 + 15 + (hold / 7) * 10) / 60;
  const tbill = deposit * TBILL_APR * (hold / 365);
  const verdict: Verdict = net > tbill && net / hours >= HOURLY_HURDLE ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  return {
    deposit,
    hold_days: hold,
    route_chain: chain,
    gas_per_tx: perTx,
    actions,
    gas_usd: gas,
    forgone_usd: forgone,
    slice_usd: slice,
    net_usd: net,
    hours,
    net_per_hour: net / hours,
    tbill_usd: tbill,
    verdict,
  };
}

// ---------------------------------------------------------------- farm plans

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $1,000 of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $1,000 of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $1,000 of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $1,000 of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $1,000 of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $1,000 and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $1,000 into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $1,000 of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $1,000 of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $1,000 of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $1,000 of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, age)
 * and the v6 economics (route chain, hold, action count, gas), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, asOf: string, econ: FarmEconomics): FarmStep[] {
  const chain = econ.route_chain;
  const hold = econ.hold_days;
  const action = actionFor(p, chain);
  const weeklyGas = econ.gas_per_tx;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `under $${Math.max(1, Math.ceil(econ.gas_per_tx * 2))} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$1,000 of capital and about $${econ.gas_usd.toFixed(2)} of gas over the whole plan`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $${weeklyGas.toFixed(2)} of gas a week on ${chain}`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $1,000 stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ---------------------------------------------------------------- the board

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  family: Family;
  value_usd: number;
  token_odds: number;
  implied_value_usd: number;
  band_low_usd: number;
  band_high_usd: number;
  band_low10_usd: number;
  band_high90_usd: number;
  verdict: Verdict;
  net_usd: number;
  net_per_hour_usd: number;
  gas_usd: number;
  forgone_usd: number;
  slice_usd: number;
  hold_days: number;
  route_chain: string;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The dashboard's compact view of one row, with the farm plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  family: Family;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  value_usd: number;
  token_odds: number;
  implied_value_usd: number;
  band_low_usd: number;
  band_high_usd: number;
  band_low10_usd: number;
  band_high90_usd: number;
  verdict: Verdict;
  verdict10k: Verdict;
  net_usd: number;
  net10k_usd: number;
  net_per_hour_usd: number;
  net10k_per_hour_usd: number;
  gas_usd: number;
  forgone_usd: number;
  slice_usd: number;
  hold_days: number;
  route_chain: string;
  actions: number;
  hours: number;
  steps: string[];
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  board_total_usd: number;
  verdicts: Record<Verdict, number>;
  verdicts10k: Record<Verdict, number>;
  seal: string;
  ledger: Ledger;
  value: {
    slope: number;
    intercept: number;
    r2: number;
    n: number;
    offsets: Record<Family, number>;
    loo: OosReading;
    loo_curve: OosReading;
    loo_flat: OosReading;
    walk_forward: OosReading;
    walk_forward_curve: OosReading;
    walk_forward_flat: OosReading;
    hash_a_b: OosReading;
    hash_b_a: OosReading;
    hash_pooled: number;
    hash_curve_pooled: number;
    hash_flat_a_b: number;
    hash_flat_b_a: number;
    control_shuffled: OosReading;
    control_shuffled_flat: OosReading;
    band_p25: number;
    band_p75: number;
    band_p10: number;
    band_p90: number;
    walk_forward_cover50: number;
    walk_forward_cover80: number;
  };
  odds: {
    beta: number[];
    peers: number;
    token_rate: number;
    brier_cv: number;
    brier_base: number;
    brier_age_only: number;
    brier_fam_only: number;
    brier_walk_forward: number;
    brier_walk_forward_base: number;
    brier_control: number;
    calibration: { predicted: number; actual: number; n: number }[];
  };
  scatter: { x: number; y: number; family: Family; slug: string }[];
  best_net_per_hour: { slug: string; name: string; net_per_hour: number; net: number; verdict: Verdict };
  rows: RadarRow[];
  live: LiveRow[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const comps = comparables(snapshot);
  const valueFit = fitValue(comps);
  const loo = leaveOneOut(comps);
  const walkForward = walkForwardValue(comps);
  const hash = hashHoldout(comps);
  const control = shuffledMcapControl(comps);
  // The honest bands: quantiles of the leave-one-out ratios (actual / predicted).
  const looRatios = loo.logErrors.map((e) => Math.exp(e)).sort((a, b) => a - b);
  const bandP25 = quantile(looRatios, 0.25);
  const bandP75 = quantile(looRatios, 0.75);
  const bandP10 = quantile(looRatios, 0.1);
  const bandP90 = quantile(looRatios, 0.9);
  const coverage = walkForwardCoverage(comps, bandP25, bandP75, bandP10, bandP90);

  const peers = oddsPeers(snapshot);
  const beta = fitLogit(peers, snapshot.as_of);
  const tokenRate = peers.filter(hasToken).length / peers.length;
  const brierCv = oddsCrossValidated(peers, snapshot.as_of);
  const brierBase = tokenRate * (1 - tokenRate);
  const brierAgeOnly = oddsCrossValidated(peers, snapshot.as_of, (p) => (hasToken(p) ? 1 : 0), ageOnlyFeatures);
  const brierFamOnly = oddsCrossValidated(peers, snapshot.as_of, (p) => (hasToken(p) ? 1 : 0), famOnlyFeatures);
  const wfOdds = oddsWalkForward(peers, snapshot.as_of);
  const brierControl = permutedLabelControl(peers, snapshot.as_of);
  const calibration = oddsCalibration(peers, snapshot.as_of, beta);

  const watchlist = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter(isRankable);
  const scored = chosen.map((p) => {
    const value = Math.max(1, Math.round(predictValue(p, valueFit)));
    const odds = predictOdds(p, snapshot.as_of, beta);
    const implied = Math.max(1, Math.round(value * odds));
    const econ = economicsFor(implied, p.tvl_usd, p, snapshot.as_of, STANDARD_DEPOSIT);
    const econ10k = economicsFor(implied, p.tvl_usd, p, snapshot.as_of, LARGE_DEPOSIT);
    return { p, value, odds, implied, econ, econ10k };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.p.listed_at === null ? null : ageOf(s.p, snapshot.as_of),
    family: familyOf(s.p.category),
    value_usd: s.value,
    token_odds: round4(s.odds),
    implied_value_usd: s.implied,
    band_low_usd: Math.max(1, Math.round(s.implied * bandP25)),
    band_high_usd: Math.max(1, Math.round(s.implied * bandP75)),
    band_low10_usd: Math.max(1, Math.round(s.implied * bandP10)),
    band_high90_usd: Math.max(1, Math.round(s.implied * bandP90)),
    verdict: s.econ.verdict,
    net_usd: round2(s.econ.net_usd),
    net_per_hour_usd: round2(s.econ.net_per_hour),
    gas_usd: round2(s.econ.gas_usd),
    forgone_usd: round2(s.econ.forgone_usd),
    slice_usd: round2(s.econ.slice_usd),
    hold_days: s.econ.hold_days,
    route_chain: s.econ.route_chain,
    farm_steps: farmSteps(s.p, snapshot.as_of, s.econ).map(stepText),
  }));

  const verdicts: Record<Verdict, number> = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  const verdicts10k: Record<Verdict, number> = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  for (const s of scored) {
    verdicts[s.econ.verdict]++;
    verdicts10k[s.econ10k.verdict]++;
  }
  const boardTotal = board.reduce((a, r) => a + r.implied_value_usd, 0);
  const best = [...scored].sort((a, b) => b.econ.net_per_hour - a.econ.net_per_hour)[0]!;

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: LIVE_ROWS,
    board_total_usd: boardTotal,
    verdicts,
    verdicts10k,
    seal: '',
    ledger: ledgerOf(snapshot),
    value: {
      slope: round4(valueFit.slope),
      intercept: round4(valueFit.intercept),
      r2: round4(valueFit.r2),
      n: comps.length,
      offsets: valueFit.offsets,
      loo: loo.full,
      loo_curve: loo.curve,
      loo_flat: loo.flat,
      walk_forward: walkForward.full,
      walk_forward_curve: walkForward.curve,
      walk_forward_flat: walkForward.flat,
      hash_a_b: hash.aToB,
      hash_b_a: hash.bToA,
      hash_pooled: round4(hash.pooled),
      hash_curve_pooled: round4(hash.curvePooled),
      hash_flat_a_b: round4(hash.flatAtoB),
      hash_flat_b_a: round4(hash.flatBtoA),
      control_shuffled: control.full,
      control_shuffled_flat: control.flat,
      band_p25: round4(bandP25),
      band_p75: round4(bandP75),
      band_p10: round4(bandP10),
      band_p90: round4(bandP90),
      walk_forward_cover50: round4(coverage.cover50),
      walk_forward_cover80: round4(coverage.cover80),
    },
    odds: {
      beta: beta.map(round4),
      peers: peers.length,
      token_rate: round4(tokenRate),
      brier_cv: round4(brierCv),
      brier_base: round4(brierBase),
      brier_age_only: round4(brierAgeOnly),
      brier_fam_only: round4(brierFamOnly),
      brier_walk_forward: round4(wfOdds.brier),
      brier_walk_forward_base: round4(wfOdds.base),
      brier_control: round4(brierControl),
      calibration: calibration.map((c) => ({ predicted: round4(c.predicted), actual: round4(c.actual), n: c.n })),
    },
    scatter: comps.map((p) => ({
      x: round4(Math.log(p.tvl_usd)),
      y: round4(Math.log(p.mcap_usd!)),
      family: familyOf(p.category),
      slug: p.slug,
    })),
    best_net_per_hour: {
      slug: best.p.slug,
      name: best.p.name,
      net_per_hour: round2(best.econ.net_per_hour),
      net: round2(best.econ.net_usd),
      verdict: best.econ.verdict,
    },
    rows: board.map((r, i) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      family: r.family,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      watchlist: watchlist.has(r.slug),
      value_usd: r.value_usd,
      token_odds: r.token_odds,
      implied_value_usd: r.implied_value_usd,
      band_low_usd: r.band_low_usd,
      band_high_usd: r.band_high_usd,
      band_low10_usd: r.band_low10_usd,
      band_high90_usd: r.band_high90_usd,
      verdict: r.verdict,
      verdict10k: scored[i]!.econ10k.verdict,
      net_usd: r.net_usd,
      net10k_usd: round2(scored[i]!.econ10k.net_usd),
      net_per_hour_usd: r.net_per_hour_usd,
      net10k_per_hour_usd: round2(scored[i]!.econ10k.net_per_hour),
      gas_usd: r.gas_usd,
      forgone_usd: r.forgone_usd,
      slice_usd: r.slice_usd,
      hold_days: r.hold_days,
      route_chain: r.route_chain,
      actions: scored[i]!.econ.actions,
      hours: round2(scored[i]!.econ.hours),
      steps: board[i]!.farm_steps,
    })),
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100000000000000) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
