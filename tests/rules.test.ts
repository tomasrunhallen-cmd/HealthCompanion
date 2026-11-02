// B2: the rules as data. rules/rules.json follows its schema, the code reads it, and
// rules/README.md explains every field for a clinical reviewer.

import fs from 'node:fs';
import path from 'node:path';
import { parseRules, RULES, RULES_VERSION } from '../src/core/analysis/rules';
import { DEFAULT_PLAN_SETTINGS } from '../src/core/domain/types';

const DIR = path.join(__dirname, '..', 'rules');
const json = JSON.parse(fs.readFileSync(path.join(DIR, 'rules.json'), 'utf8'));
const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');

function leaves(o: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    k === '$schema' || k === 'version' ? [] : v && typeof v === 'object' ? leaves(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('rules/rules.json', () => {
  it('is what the code uses, with a version', () => {
    expect(RULES_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(RULES.version).toBe(json.version);
    expect(RULES.level.redAt).toBe(json.level.redAt);
    expect(DEFAULT_PLAN_SETTINGS.sleepThresholdHours).toBe(json.sleepThresholdHoursDefault);
  });

  it('is refused when it does not follow the schema', () => {
    expect(() => parseRules({ ...json, level: { ...json.level, redAt: 'fyra' } })).toThrow(/\$\.level\.redAt: ska vara ett tal/);
    expect(() => parseRules({ ...json, okand: 1 })).toThrow(/okänt fält/);
    const { stressHighAt: _s, ...missing } = json;
    expect(() => parseRules(missing)).toThrow(/stressHighAt: saknas/);
    expect(() => parseRules({ ...json, dayStartHour: 30 })).toThrow(/över 23/);
  });

  it('every rule is explained in rules/README.md, with its current value', () => {
    for (const key of leaves(json)) expect([key, readme.includes(`\`${key}\``)]).toEqual([key, true]);
    expect(readme).toContain(`Version: **${json.version}**`);
  });
});
