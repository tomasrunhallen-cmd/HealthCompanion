// Does Dygnsrytm do anything better than the sleep notice? The history is played back in
// time order: for each morning a method may only use nights up to that morning, the activity of
// the evening before, and episode starts that lay at least a week back. Documented episode starts
// are the truth, never the app's earlier colours. The thresholds in rules/rules.json were set
// before any evaluation; the later half of the period is reported on its own as the held-out part,
// and any future tuning may only use the earlier half.

import type { DateKey, MeasuredDay } from '../domain/types';
import { addDays, daysBetween, formatDateSvYear } from './dates';
import { RULES } from './rules';
import { detect, prepare, type RhythmPattern, type EpisodeStart, type EpisodeType, type RhythmData } from './rhythm';
import { sleepNotice } from './sleepNotice';

const R = RULES.rhythm;

export type EvalMethod = 'notice' | 'sleep' | 'sleep_activity';
export const METHOD_NAME: Record<EvalMethod, string> = {
  notice: 'Sömnnotisen (i dag)',
  sleep: 'Modellen, bara sömn',
  sleep_activity: 'Modellen, sömn och aktivitet',
};

export interface TypeResult {
  /** Documented starts of this type in the part. */
  episodes: number;
  /** Starts where the method could judge at least one of the days before. */
  evaluable: number;
  /** Starts with an alarm in the days before (the hypothesis: within three days). */
  caught: number;
  /** Days of warning for each caught start: from the first day of the alarm run. */
  leadDays: number[];
}

export interface MethodResult {
  method: EvalMethod;
  perType: Record<EpisodeType, TypeResult>;
  /** Alarm runs with no documented start within three days after, outside episodes. */
  falseAlarms: number;
  /** Every alarm run that started in the part outside documented episodes, oldest first, with what the model saw on its first day. */
  alarms: { from: DateKey; to: DateKey; patterns: RhythmPattern[]; startFollowed: boolean }[];
  /** Days outside episodes the method could judge: the months for the false-alarm rate. */
  judgedStableDays: number;
  /** Days the method said "för lite data". */
  abstainDays: number;
  days: number;
}

export interface EvalPart {
  name: 'utveckling' | 'test';
  from: DateKey;
  to: DateKey;
  methods: MethodResult[];
}

export interface RhythmEvaluation {
  from: DateKey;
  to: DateKey;
  /** The first day of the held-out part. */
  holdoutFrom: DateKey;
  parts: EvalPart[];
  episodes: { total: number; byType: Record<EpisodeType, number>; bySource: { self_retro: number; clinical: number } };
  /** Days with sleep from the watch, and with enough heart rate for activity. */
  coverage: { days: number; nights: number; evenings: number };
  /** True when the data are simulated test cases, not the person's own. */
  simulated: boolean;
}

/** Fewer evaluable starts than this per type: the result says so instead of a rate. */
export const MIN_EPISODES_FOR_RATE = 3;

interface Options {
  from?: DateKey;
  to: DateKey;
  sleepWindow?: { start: string; end: string } | null;
  simulated?: boolean;
}

function upTo(measured: Record<DateKey, MeasuredDay>, d: DateKey): Record<DateKey, MeasuredDay> {
  const out: Record<DateKey, MeasuredDay> = {};
  for (let i = 0; i < 40; i++) {
    const k = addDays(d, -i);
    if (measured[k]) out[k] = measured[k];
  }
  return out;
}

function inEpisode(d: DateKey, eps: EpisodeStart[]): boolean {
  return eps.some((e) => d >= e.start && d <= (e.end ?? addDays(e.start, R.episodeDefaultDays - 1)));
}

export type Calls = Record<EvalMethod, Map<DateKey, 'alarm' | 'quiet' | 'abstain'>> & {
  /** The model's patterns on alarm days, per model method. */
  patterns: Record<'sleep' | 'sleep_activity', Map<DateKey, RhythmPattern[]>>;
};

/** Per day and method: 'alarm', 'quiet' or 'abstain'. */
export function dailyCalls(data: RhythmData, from: DateKey, to: DateKey, sleepWindow: Options['sleepWindow']): Calls {
  const first = Object.keys(data.measured).sort()[0] ?? from;
  const p = prepare(data.measured, data.activity, first < from ? first : from, to);
  const out: Calls = { notice: new Map(), sleep: new Map(), sleep_activity: new Map(), patterns: { sleep: new Map(), sleep_activity: new Map() } };
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const known = data.episodes.filter((e) => e.start <= addDays(d, -(R.baselineGapDays + 1)));
    const nights = [0, 1, 2].map((i) => data.measured[addDays(d, -i)]?.sleepHours);
    if (nights.some((h) => h == null)) out.notice.set(d, 'abstain');
    else out.notice.set(d, sleepNotice(upTo(data.measured, d), d, { window: sleepWindow ?? null, sleepRoutine: null }) ? 'alarm' : 'quiet');
    for (const [m, act] of [['sleep', false], ['sleep_activity', true]] as const) {
      const r = detect(p, d, known, act);
      out[m].set(d, r.status === 'insufficient' ? 'abstain' : r.status === 'change' ? 'alarm' : 'quiet');
      if (r.status === 'change') out.patterns[m].set(d, r.changes.map((c) => c.pattern));
    }
  }
  return out;
}

function runsOf(calls: Map<DateKey, string>, from: DateKey, to: DateKey): { from: DateKey; to: DateKey }[] {
  const runs: { from: DateKey; to: DateKey }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (calls.get(d) !== 'alarm') continue;
    const last = runs[runs.length - 1];
    if (last && daysBetween(last.to, d) <= 2) last.to = d;
    else runs.push({ from: d, to: d });
  }
  return runs;
}

function scorePart(method: EvalMethod, calls: Map<DateKey, 'alarm' | 'quiet' | 'abstain'>, eps: EpisodeStart[], from: DateKey, to: DateKey, patterns?: Map<DateKey, RhythmPattern[]>): MethodResult {
  const perType: Record<EpisodeType, TypeResult> = {
    up: { episodes: 0, evaluable: 0, caught: 0, leadDays: [] },
    down: { episodes: 0, evaluable: 0, caught: 0, leadDays: [] },
    mixed: { episodes: 0, evaluable: 0, caught: 0, leadDays: [] },
  };
  const runs = runsOf(calls, addDays(from, -30), to);
  for (const e of eps.filter((x) => x.start >= from && x.start <= to)) {
    const t = perType[e.type];
    t.episodes++;
    const before = Array.from({ length: R.horizonDays }, (_, i) => addDays(e.start, -(i + 1)));
    if (before.every((d) => calls.get(d) === 'abstain' || calls.get(d) == null)) continue;
    t.evaluable++;
    const hit = before.filter((d) => calls.get(d) === 'alarm').sort()[0];
    if (!hit) continue;
    t.caught++;
    const run = runs.find((r) => r.from <= hit && r.to >= hit);
    t.leadDays.push(daysBetween(run?.from ?? hit, e.start));
  }
  let falseAlarms = 0;
  const alarms: MethodResult['alarms'] = [];
  for (const r of runs.filter((x) => x.from >= from && x.from <= to)) {
    if (inEpisode(r.from, eps)) continue;
    const real = eps.some((e) => e.start > r.from && e.start <= addDays(r.to, R.horizonDays));
    if (!real) falseAlarms++;
    alarms.push({ ...r, patterns: patterns?.get(r.from) ?? [], startFollowed: real });
  }
  let judgedStableDays = 0, abstainDays = 0, days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days++;
    const c = calls.get(d);
    if (c === 'abstain' || c == null) abstainDays++;
    else if (!inEpisode(d, eps)) judgedStableDays++;
  }
  return { method, perType, falseAlarms, alarms, judgedStableDays, abstainDays, days };
}

export function evaluateRhythm(data: RhythmData, opts: Options): RhythmEvaluation {
  const dates = Object.keys(data.measured).filter((d) => data.measured[d].sleepHours != null && d <= opts.to).sort();
  const from = opts.from ?? (dates[0] ? addDays(dates[0], R.baselineMinNights + R.baselineGapDays) : opts.to);
  const to = opts.to;
  const total = Math.max(1, daysBetween(from, to) + 1);
  const holdoutFrom = addDays(from, Math.floor(total / 2));
  const calls = dailyCalls(data, from, to, opts.sleepWindow);
  const parts: EvalPart[] = [
    { name: 'utveckling', from, to: addDays(holdoutFrom, -1) },
    { name: 'test', from: holdoutFrom, to },
  ].map((p) => ({ ...p, name: p.name as EvalPart['name'], methods: (['notice', 'sleep', 'sleep_activity'] as EvalMethod[]).map((m) => scorePart(m, calls[m], data.episodes, p.from, p.to, m === 'notice' ? undefined : calls.patterns[m])) }));
  const inRange = data.episodes.filter((e) => e.start >= from && e.start <= to);
  let nights = 0, evenings = 0;
  const p = prepare(data.measured, data.activity, from, to);
  for (const n of p.nights.values()) if (!n.excluded) nights++;
  for (const e of p.evenings.values()) if (e.late != null) evenings++;
  return {
    from, to, holdoutFrom, parts,
    episodes: {
      total: inRange.length,
      byType: { up: inRange.filter((e) => e.type === 'up').length, down: inRange.filter((e) => e.type === 'down').length, mixed: inRange.filter((e) => e.type === 'mixed').length },
      bySource: { self_retro: inRange.filter((e) => e.source === 'self_retro').length, clinical: inRange.filter((e) => e.source === 'clinical').length },
    },
    coverage: { days: total, nights, evenings },
    simulated: !!opts.simulated,
  };
}

// ---- the report, in Swedish ----

const TYPE_LABEL: Record<EpisodeType, string> = { up: 'Uppvarvade', down: 'Nedstämda', mixed: 'Blandade' };

export function rate(n: number, days: number): string {
  if (days < 30) return `${n} på ${days} dagar`;
  return `${String(Math.round((n / (days / 30)) * 10) / 10).replace('.', ',')} per månad (${n} på ${days} dagar)`;
}

function lead(xs: number[]): string {
  if (!xs.length) return '–';
  const s = [...xs].sort((a, b) => a - b);
  if (s[0] === s[s.length - 1]) return s.length === 1 ? `${s[0]} dygn` : `${s[0]} dygn för alla ${s.length}`;
  return `${s[0]}–${s[s.length - 1]} dygn (median ${s[Math.floor(s.length / 2)]})`;
}

/** The evaluation as markdown, every rate with the counts behind it. */
export function evaluationReport(ev: RhythmEvaluation): string {
  const out: string[] = [];
  out.push(ev.simulated
    ? '> **Simulerade testfall.** Resultaten nedan kommer från påhittade data som appen genererar för att testa reglerna. De säger ingenting om hur modellen fungerar för dig.'
    : '> **Dina egna data.** Uppspelning i tidsordning av dina klockdata och de episodstarter du dokumenterat.');
  out.push('');
  out.push(`Period: ${formatDateSvYear(ev.from)} – ${formatDateSvYear(ev.to)} (${ev.coverage.days} dagar). Nätter med sömn från klockan: ${ev.coverage.nights}. Kvällar med tillräcklig puls för aktivitet: ${ev.coverage.evenings}.`);
  out.push(`Episodstarter i perioden: ${ev.episodes.total} (uppvarvade ${ev.episodes.byType.up}, nedstämda ${ev.episodes.byType.down}, blandade ${ev.episodes.byType.mixed}). Källa: ${ev.episodes.bySource.self_retro} angivna i efterhand, ${ev.episodes.bySource.clinical} från klinisk bedömning.`);
  out.push(`Trösklarna sattes i rules/rules.json före utvärderingen. Testdelen från ${formatDateSvYear(ev.holdoutFrom)} redovisas för sig och får aldrig användas för att justera dem.`);
  for (const part of ev.parts) {
    out.push('');
    out.push(`### ${part.name === 'test' ? 'Testdel (hållen utanför)' : 'Utvecklingsdel'}: ${formatDateSvYear(part.from)} – ${formatDateSvYear(part.to)}`);
    out.push('');
    out.push('| Metod | Typ | Starter | Bedömbara | Fångade i förväg | Förvarning | ');
    out.push('| --- | --- | --- | --- | --- | --- |');
    for (const m of part.methods) {
      for (const t of ['up', 'down', 'mixed'] as EpisodeType[]) {
        const r = m.perType[t];
        if (!r.episodes) continue;
        const caught = r.evaluable < MIN_EPISODES_FOR_RATE ? `${r.caught} av ${r.evaluable} (för få för en andel)` : `${r.caught} av ${r.evaluable}`;
        out.push(`| ${METHOD_NAME[m.method]} | ${TYPE_LABEL[t]} | ${r.episodes} | ${r.evaluable} | ${caught} | ${lead(r.leadDays)} |`);
      }
    }
    out.push('');
    const known = ev.episodes.total > 0;
    out.push(known ? '| Metod | Falsklarm | Avstod | ' : '| Metod | Larm, inga episoder att jämföra med | Avstod | ');
    out.push('| --- | --- | --- |');
    for (const m of part.methods) {
      out.push(`| ${METHOD_NAME[m.method]} | ${rate(m.falseAlarms, m.judgedStableDays)} | ${m.abstainDays} av ${m.days} dagar |`);
    }
    const anyEp = part.methods[0].perType;
    const n = anyEp.up.episodes + anyEp.down.episodes + anyEp.mixed.episodes;
    if (n < MIN_EPISODES_FOR_RATE) out.push('', `För få dokumenterade episoder i den här delen (${n}) för att säga något om hur ofta starter fångas. ${ev.episodes.total ? 'Falsklarmen' : 'Larmen'} och hur ofta modellen avstod går att läsa ändå.`);
  }
  return out.join('\n');
}
