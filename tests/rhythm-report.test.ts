// RYTMRAPPORT.md: the simulated part of the report is exactly what the code gives today, so the
// report cannot drift from the model. `UPDATE_RHYTHM_REPORT=1 npx jest tests/rhythm-report.test.ts` rewrites it.

import fs from 'node:fs';
import path from 'node:path';
import { evaluateRhythm, evaluationReport } from '../src/core/analysis/rhythmEval';
import { simulatedYear } from '../src/core/analysis/rhythmSim';

const FILE = path.join(__dirname, '..', 'RYTMRAPPORT.md');
const START = '<!-- simulerat:start -->';
const END = '<!-- simulerat:slut -->';

function simulated(): string {
  const { data, description } = simulatedYear('2026-11-13');
  const ev = evaluateRhythm(data, { to: '2026-11-13', simulated: true });
  return [...description.map((d) => `- ${d}`), '', evaluationReport(ev)].join('\n');
}

test('the simulated part of RYTMRAPPORT.md is what the code gives', () => {
  const doc = fs.readFileSync(FILE, 'utf8');
  const now = simulated();
  if (process.env.UPDATE_RHYTHM_REPORT) {
    const a = doc.indexOf(START), b = doc.indexOf(END);
    fs.writeFileSync(FILE, `${doc.slice(0, a + START.length)}\n${now}\n${doc.slice(b)}`);
    return;
  }
  const inside = doc.slice(doc.indexOf(START) + START.length, doc.indexOf(END)).trim();
  expect(inside).toBe(now.trim());
});
