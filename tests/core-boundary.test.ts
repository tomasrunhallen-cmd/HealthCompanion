// B1: the core package has no platform dependencies. It imports only from itself and from
// two plain JavaScript libraries, never React Native, Expo, the database, the network or files.

import fs from 'node:fs';
import path from 'node:path';

const CORE = path.join(__dirname, '..', 'src', 'core');
const ALLOWED_PACKAGES = new Set(['fflate', 'unpdf']);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : [],
  );
}

describe('@dagsljus/core', () => {
  const all = files(CORE);

  it('holds scoring, level, emergency rule, scrubbing, plan import, prompt loader and context bank', () => {
    const rel = all.map((f) => path.relative(CORE, f));
    for (const f of ['analysis/scoring.ts', 'analysis/rules.ts', 'context/akut.ts', 'privacy/scrub.ts', 'plan/importPlan.ts', 'prompts/loader.ts', 'context/buildContext.ts']) {
      expect(rel).toContain(f);
    }
  });

  it.each(files(CORE).map((f) => [path.relative(CORE, f), f]))('%s imports nothing outside the core but plain libraries', (_name, file) => {
    const src = fs.readFileSync(file, 'utf8');
    const specs = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? m[2]);
    for (const spec of specs) {
      if (spec.startsWith('.')) {
        const target = path.resolve(path.dirname(file), spec);
        expect([spec, target.startsWith(CORE)]).toEqual([spec, true]);
      } else {
        expect([spec, ALLOWED_PACKAGES.has(spec)]).toEqual([spec, true]);
      }
    }
  });
});
