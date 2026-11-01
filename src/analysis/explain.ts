// A short, plain account of how an assessment came about: which data it used, which
// signs gave points and which rule set the level. Written in code from the stored
// assessment, never by the language model, so it always matches the level shown.

import type { Assessment, Entry, GarminDay, LevelReason } from '../domain/types';
import { formatTime } from './dates';
import { RULES } from './rules';

export interface Explanation {
  data: string[];
  signs: { label: string; points: number }[];
  conclusion: string;
}

function dec(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Older assessments have no stored reason; all rules but the history one follow from the signals. */
function reasonOf(a: Assessment): LevelReason {
  if (a.levelReason) return a.levelReason;
  const L = RULES.level;
  if (a.level === 'green') return 'nothing';
  if (a.level === 'yellow') return 'points';
  if (a.points >= L.redAt) return 'points_red';
  if (a.signals.some((s) => s.kind === 'serious_sign') && a.signals.length >= 2) return 'serious_plus_other';
  if (a.signals.filter((s) => s.measured).length >= L.redMeasuredSigns) return 'measured_three';
  return 'recent_days';
}

function conclusion(a: Assessment): string {
  const L = RULES.level;
  const p = `${a.points} poäng`;
  switch (reasonOf(a)) {
    case 'nothing':
      return 'Inga tecken och inga avvikande mätvärden, 0 poäng. Det ger grönt.';
    case 'points':
      return `${p} ger gult. Gult börjar vid ${L.yellowAt} poäng och rött vid ${L.redAt}.`;
    case 'points_red':
      return `${p} ger rött. Rött börjar vid ${L.redAt} poäng.`;
    case 'serious_plus_other':
      return 'Ett allvarligt tecken tillsammans med ett annat tecken ger rött, oavsett poäng.';
    case 'measured_three':
      return `${L.redMeasuredSigns} mätta tecken samma dag ger rött, oavsett poäng.`;
    case 'akut':
      return 'Det du skrev liknar formuleringar om att inte vilja leva eller att skada dig. Då visar appen alltid rött och krisnumren, oavsett poäng. Anteckningen skickades inte till någon språkmodell.';
    case 'standard_cap':
      return `${p} hade gett rött, men en del av poängen kommer från standardtecken som du inte bekräftat. De kan bara ge gult, så det blir gult.`;
    case 'recent_days':
      return `${p} ger rött när minst ${L.historyNonGreenDays} av de senaste ${L.historyWindowDays} dagarna varit gula eller röda${a.recentNonGreenDays != null ? `. Det var ${a.recentNonGreenDays}` : ''}.`;
  }
}

export function explainAssessment(entry: Entry, a: Assessment, garmin: GarminDay | null): Explanation {
  const data: string[] = [];

  if (entry.kind === 'heavy') data.push('Ingen anteckning: du tryckte Orkar bara trycka');
  else if (entry.transcript.trim()) data.push(`Din anteckning, ${words(entry.transcript)} ord`);
  else data.push('Ingen anteckning');

  if (entry.mood != null && entry.energy != null) data.push(`Stämning ${entry.mood} och energi ${entry.energy}, mot snittet för sju dagar`);

  if (entry.sleepHours != null) {
    data.push(
      entry.sleepSource === 'garmin'
        ? `Sömn ${dec(entry.sleepHours)} h från Garmin${garmin?.sleepStart ? `, somnade ${garmin.sleepStart}` : ''}`
        : `Sömn ${dec(entry.sleepHours)} h, skattat ur anteckningen`,
    );
  } else {
    data.push('Sömn saknas');
  }

  if (entry.stressAvg != null) {
    data.push(
      a.baseline.stressAvg != null
        ? `Stress ${entry.stressAvg} i dag, ditt vanliga ${dec(a.baseline.stressAvg)}`
        : `Stress ${entry.stressAvg} i dag, ingen baslinje än`,
    );
  }
  if (garmin?.bodyBatteryWake != null) data.push(`Body Battery ${garmin.bodyBatteryWake} vid uppvaknandet`);
  if (entry.kind === 'checkin') data.push(`Inlägget gjordes ${formatTime(entry.createdAt)}`);

  if (a.akut) data.push('Anteckningen jämfördes bara på telefonen. Den skickades inte till någon språkmodell');
  else if (a.method === 'llm') data.push(`Tecknen tolkades av ${a.model ?? 'din språkmodell'}, med dagens och veckans mätvärden som bakgrund`);
  else if (a.method === 'llm_fallback') data.push('Språkmodellen svarade inte, så tecknen hittades med ordmatchning');
  else if (a.method === 'wordmatch') data.push('Tecknen hittades med ordmatchning på telefonen');

  if (a.baseline.greenDays < RULES.baselineMinSamples) {
    data.push(`Baslinjen är inte klar: ${a.baseline.greenDays} av ${RULES.baselineMinSamples} gröna dagar`);
  }

  return {
    data,
    signs: a.signals.map((s) => ({ label: s.label, points: s.points })),
    conclusion: conclusion(a),
  };
}
