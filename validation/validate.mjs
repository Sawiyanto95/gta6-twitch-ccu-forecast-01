// Local-only scorer: actual entry and starter executables on identical folds.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kit = path.resolve(process.argv[2] ?? path.join(entry, '../gta6-twitch-ccu-forecast-01-kit'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-cv-'));
const levels = [.05, .25, .5, .75, .95];
const mkdir = (p) => fs.mkdirSync(p, { recursive: true });
const write = (p, value) => fs.writeFileSync(p, JSON.stringify(value));
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
function execute(program, input, output) {
  mkdir(output);
  const began = performance.now();
  const run = spawnSync(process.execPath, [program], {
    env: { ...process.env, MAKEFUN_INPUT_DIR: input, MAKEFUN_OUTPUT_DIR: output },
    encoding: 'utf8', timeout: 30_000,
  });
  const milliseconds = performance.now() - began;
  if (run.error || run.status !== 0) throw new Error(`${program}: ${run.error ?? run.stderr}`);
  return milliseconds;
}
function check(filename) {
  const bytes = fs.readFileSync(filename);
  const result = JSON.parse(bytes);
  if (bytes.length > 65536 || Object.keys(result).join() !== 'hours' || result.hours.length !== 23) throw new Error('Bad output object');
  const seen = new Set();
  for (const row of result.hours) {
    if (Object.keys(row).sort().join() !== 'hour,q' || !Number.isInteger(row.hour) || row.hour < 2 || row.hour > 24 || seen.has(row.hour)) throw new Error('Bad hour');
    seen.add(row.hour);
    if (!Array.isArray(row.q) || row.q.length !== 5 || row.q.some((q, i) => !Number.isFinite(q) || q <= 0 || q > 1e9 || (i && q < row.q[i - 1]))) throw new Error('Bad quantiles');
  }
  return result;
}
function score(output, answers) {
  let loss = 0, items = 0, covered = 0, hours = 0, medianError = 0;
  for (const row of output.hours) {
    if (!answers.has(row.hour)) continue;
    const y = Math.max(1, answers.get(row.hour));
    row.q.forEach((q, j) => {
      const d = Math.log(y) - Math.log(q);
      loss += 2 * Math.max(levels[j] * d, (levels[j] - 1) * d);
      items++;
    });
    covered += +(y >= row.q[0] && y <= row.q[4]);
    medianError += Math.abs(Math.log(y) - Math.log(row.q[2]));
    hours++;
  }
  return { loss, items, covered, hours, medianError };
}
const reports = [];
const foldResults = [];
try {
  for (let ci = 0; ci < 4; ci++) {
    const caseId = `p0${ci}`;
    const practice = read(path.join(kit, 'input', `${caseId}.in`));
    const input = path.join(temporary, caseId, 'input'); mkdir(input);
    const folds = [];
    for (const [index, held] of practice.comparables.entries()) {
      const start = Date.parse(held.day_start);
      const actual = new Map(held.hourly.map((p) => [Date.parse(p.from), p.viewers]));
      if (!actual.has(start)) continue; // The pre-release GTA category is not a launch.
      const id = `fold-${index}`;
      const checkpoint = start + 3_600_000;
      const before = held.hourly.filter((p) => Date.parse(p.from) < checkpoint);
      const target = {
        ...practice, id, day_start: held.day_start, checkpoint: new Date(checkpoint).toISOString(),
        game: { name: held.name },
        known: [{ hour: 1, viewers: actual.get(start) }],
        history_hourly: before,
        history: before.map(({ from, ...rest }) => ({ at: from, ...rest })),
        forecast: Array.from({ length: 23 }, (_, j) => ({ hour: j + 2 })),
        streams: null, categories_hourly: null,
        comparables: practice.comparables.filter((c) => c !== held),
      };
      write(path.join(input, id + '.in'), target);
      const answers = new Map();
      for (let h = 2; h <= 24; h++) if (actual.has(start + (h - 1) * 3_600_000)) answers.set(h, actual.get(start + (h - 1) * 3_600_000));
      folds.push({ id, name: held.name, first: actual.get(start), answers });
    }
    const modelDir = path.join(temporary, caseId, 'model');
    const baselineDir = path.join(temporary, caseId, 'baseline');
    execute(path.join(entry, 'main.ts'), input, modelDir);
    execute(path.join(kit, 'starter/main.ts'), input, baselineDir);
    let model = 0, baseline = 0, items = 0, covered = 0, hours = 0;
    for (const fold of folds) {
      const m = score(check(path.join(modelDir, fold.id + '.out')), fold.answers);
      const b = score(check(path.join(baselineDir, fold.id + '.out')), fold.answers);
      model += m.loss; baseline += b.loss; items += m.items; covered += m.covered; hours += m.hours;
      foldResults.push({ case: caseId, name: fold.name, first: fold.first, model: m.loss / m.items, baseline: b.loss / b.items });
    }
    const isolated = path.join(temporary, caseId, 'practice'); mkdir(isolated);
    fs.copyFileSync(path.join(kit, 'input', caseId + '.in'), path.join(isolated, caseId + '.in'));
    const out1 = path.join(temporary, caseId, 'run1'), out2 = path.join(temporary, caseId, 'run2');
    const ms1 = execute(path.join(entry, 'main.ts'), isolated, out1);
    const ms2 = execute(path.join(entry, 'main.ts'), isolated, out2);
    check(path.join(out1, caseId + '.out')); check(path.join(out2, caseId + '.out'));
    if (!fs.readFileSync(path.join(out1, caseId + '.out')).equals(fs.readFileSync(path.join(out2, caseId + '.out')))) throw new Error('Nondeterministic output');
    if (Math.max(ms1, ms2) >= 8000) throw new Error('Runtime cap exceeded');
    reports.push({ case: caseId, launches: folds.length, scored_hours: hours, model: model / items, baseline: baseline / items, coverage_90: covered / hours, valid: true, byte_identical: true, runtime_ms: [ms1, ms2] });
  }
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const large = foldResults.filter((f) => f.first >= 20000);
  console.log(JSON.stringify({ runtime: process.version, cases: reports,
    mean_loss: { model: mean(reports.map((r) => r.model)), starter: mean(reports.map((r) => r.baseline)) },
    large_launch_loss: { model: mean(large.map((f) => f.model)), starter: mean(large.map((f) => f.baseline)) },
    note: 'The four practice comparable sets are identical: 37 unique launch folds, repeated four times. Practice answers are unavailable; these are comparable LOO scores, not the sealed practice score.',
    folds: foldResults.filter((f) => f.case === 'p00'),
  }, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
