// Launch-curve conditional distribution. Node standard library; no clock or network.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOUR = 3_600_000;
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const LAGS = [1, 3, 6];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const logCount = (x) => Math.log(Math.max(1, x));

// The series are aligned to UTC release-day hours: local-midnight launches roll
// through regions, so shifting every launch to its first unlock would misalign
// the European and American audience cycles the contest actually scores.
function hourlyMap(points, dayStart, timestampKey) {
  const sums = new Map();
  for (const point of points ?? []) {
    const at = Date.parse(point[timestampKey]);
    if (!Number.isFinite(at) || !Number.isFinite(point.viewers) || point.viewers < 0) continue;
    const h = Math.floor((at - dayStart) / HOUR + 1e-7);
    const aggregate = sums.get(h) ?? { sum: 0, n: 0 };
    aggregate.sum += point.viewers;
    aggregate.n++;
    sums.set(h, aggregate);
  }
  return new Map(Array.from(sums, ([h, a]) => [h, a.sum / a.n]));
}

function preFeatures(points, logFirst) {
  return LAGS.map((lag) => points.has(-lag)
    ? clamp(logCount(points.get(-lag)) - logFirst, -5, 5)
    : null);
}

function launchCurve(c) {
  const start = Date.parse(c.day_start);
  if (!Number.isFinite(start)) return null;
  const points = hourlyMap(c.hourly, start, 'from');
  // GTA VI's trailer/premiere history is not a launch and has no release-day
  // print. Missing prints are never manufactured by interpolating quiet days.
  if (!points.has(0)) return null;
  const first = logCount(points.get(0));
  return {
    first,
    pre: preFeatures(points, first),
    ratios: Array.from({ length: 24 }, (_, h) => points.has(h) ? logCount(points.get(h)) - first : null),
  };
}

function normalCdf(x) {
  const a = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * a);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t);
  const erf = 1 - polynomial * Math.exp(-a * a);
  return 0.5 * (1 + (x < 0 ? -erf : erf));
}

function mixtureQuantile(samples, level, residual) {
  // Convolution with a log-normal residual avoids discrete, overconfident
  // quantiles from a small analogue set. Between-launch dispersion still
  // varies freely by hour and can be asymmetric or multimodal.
  let lo = Math.min(...samples.map((s) => s.value)) - 8 * residual;
  let hi = Math.max(...samples.map((s) => s.value)) + 8 * residual;
  const total = samples.reduce((sum, s) => sum + s.weight, 0);
  for (let iteration = 0; iteration < 40; iteration++) {
    const mid = (lo + hi) / 2;
    const probability = samples.reduce((sum, s) => sum + s.weight * normalCdf((mid - s.value) / residual), 0) / total;
    if (probability < level) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function predict(data, firstPrint, comparables = data.comparables) {
  const first = logCount(firstPrint);
  const start = Date.parse(data.day_start);
  // Use whole-hour evidence where supplied; aggregate minute observations as
  // a fallback. No observation at or beyond the checkpoint enters features.
  const raw = (data.history ?? []).filter((p) => Date.parse(p.at) < start + HOUR);
  const points = hourlyMap(raw, start, 'at');
  const hourly = (data.history_hourly ?? []).filter((p) => Date.parse(p.from) < start + HOUR);
  for (const [h, value] of hourlyMap(hourly, start, 'from')) points.set(h, value);
  const targetPre = preFeatures(points, first);
  const curves = (comparables ?? []).map(launchCurve).filter((c) => c !== null);
  // An unprecedented first-hour size is weaker evidence than interpolation
  // inside the analogue range. Widen residual uncertainty outside that range.
  const sizes = curves.map((c) => c.first);
  const outside = sizes.length ? Math.max(0, first - Math.max(...sizes), Math.min(...sizes) - first) : 1;
  const residual = Math.min(1.2, Math.hypot(0.30, 0.35 * outside));
  const distances = curves.map((c) => {
    // A bandwidth of one log unit shares information across similar sizes
    // without making a few giant launches the only possible analogues.
    let distance = (first - c.first) ** 2;
    for (let j = 0; j < LAGS.length; j++) {
      if (targetPre[j] !== null && c.pre[j] !== null) {
        distance += 0.3 * (targetPre[j] - c.pre[j]) ** 2 / [0.3, 1, 2][j];
      }
    }
    return distance;
  });
  const hours = [];
  for (let hour = 2; hour <= 24; hour++) {
    const available = curves.map((c, i) => ({ c, distance: distances[i] }))
      .filter(({ c }) => c.ratios[hour - 1] !== null);
    const minDistance = Math.min(...available.map((x) => x.distance));
    const samples = available.map(({ c, distance }) => ({
      // Gentle, bounded extrapolation: a higher hour-1 print tends to imply
      // less remaining proportional growth. Never extrapolate an unbounded
      // regression slope from a handful of exceptionally large launches.
      value: c.ratios[hour - 1] - 0.2 * clamp(first - c.first, -2, 2),
      weight: Math.exp(-0.5 * (distance - minDistance)),
    }));
    if (!samples.length) samples.push({ value: 0, weight: 1 });
    let previous = 0.01;
    const q = LEVELS.map((level) => {
      const logForecast = first + mixtureQuantile(samples, level, residual);
      const value = Math.round(Math.exp(clamp(logForecast, Math.log(0.01), Math.log(1e9))) * 100) / 100;
      previous = clamp(Math.max(previous, value), 0.01, 1e9);
      return previous;
    });
    hours.push({ hour, q });
  }
  return hours;
}

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outputDir, { recursive: true });
for (const filename of readdirSync(inputDir).filter((name) => name.endsWith('.in')).sort()) {
  const data = JSON.parse(readFileSync(join(inputDir, filename), 'utf8'));
  if (!Array.isArray(data.levels) || data.levels.length !== LEVELS.length || data.levels.some((v, i) => v !== LEVELS[i])) {
    throw new Error('Unsupported quantile levels');
  }
  const first = data.known.find((point) => point.hour === 1);
  if (!first || !Number.isFinite(first.viewers)) throw new Error('Missing first-hour print');
  const result = { hours: predict(data, first.viewers) };
  writeFileSync(join(outputDir, filename.slice(0, -3) + '.out'), JSON.stringify(result) + '\n');
}
