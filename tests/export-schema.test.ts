// B6: every exported context file carries a schema number, older files are migrated forward,
// and an export from the previous version is read correctly. Also the full backup.

import { CONTEXT_SCHEMA, exportAll, parseLayer } from '../src/core/context/markdown';
import { emptySnapshot, memoryBackend } from '../src/storage/backend';
import { EXPORT_FORMAT, Repository, SCHEMA_VERSION } from '../src/storage/repository';

/** grund.md exactly as the previous version wrote it: no schema line, no row fields. */
const PREVIOUS_GRUND = `# Grund

Din krisplan och det du själv vet om dig. Ändras bara av dig. Exporterad från Dagsljus 20 oktober.

Du kan ändra texten i punkterna. Kommentarerna (<!-- ... -->) behövs för att filen ska kunna importeras igen exakt.
Nya punkter utan kommentar importeras som dina egna under rubriken de står.

## Tidigt tecken

- Svarar inte på sms
  _Från krisplanen_
  <!-- dagsljus {"id":"p1","kind":"early","order":0,"origin":"crisis_plan","createdAt":"2026-10-01T10:00:00.000Z","approvedAt":"2026-10-01T10:00:00.000Z"} -->

## Åtgärd vid rött

- Ring mottagningen
  _Från krisplanen_
  <!-- dagsljus {"id":"p2","kind":"action_red","order":0,"origin":"crisis_plan","createdAt":"2026-10-01T10:00:00.000Z","approvedAt":"2026-10-01T10:00:00.000Z"} -->

## Anhöriga gör

- Fråga hur jag sover
`;

describe('schema number on the context files', () => {
  it('writes the schema in every file and reads it back unchanged', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.addContextEntry({ kind: 'early', text: 'Pratar fort', origin: 'user', plan: { kind: 'sign', polarity: 'up', severity: 'early', observer: 'others' } });
    await repo.addContextEntry({ kind: 'routine', text: 'Tar min medicin klockan 21', origin: 'user', routine: { track: true, reminder: '21:00' } });
    const files = exportAll(repo.contextEntries());
    for (const text of Object.values(files)) expect(text.split('\n')[1]).toBe(`<!-- dagsljus-schema ${CONTEXT_SCHEMA} -->`);
    const back = parseLayer(files['grund.md']);
    expect(back.fromSchema).toBe(CONTEXT_SCHEMA);
    expect(back.entries).toEqual(repo.contextEntries('grund'));
  });

  it('reads an export from the previous version and migrates it forward', () => {
    const parsed = parseLayer(PREVIOUS_GRUND, new Date('2026-11-01T12:00:00Z'));
    expect(parsed.fromSchema).toBe(1);
    expect(parsed.entries.map((e) => [e.id.startsWith('c_') ? 'ny' : e.id, e.kind, e.text, e.plan])).toEqual([
      ['p1', 'early', 'Svarar inte på sms', { kind: 'sign', polarity: 'both', severity: 'early', observer: 'self' }],
      ['p2', 'action_red', 'Ring mottagningen', { kind: 'action', polarity: 'both', when: 'serious', who: 'me', order: null }],
      ['ny', 'relatives', 'Fråga hur jag sover', { kind: 'action', polarity: 'both', when: 'always', who: 'relative', order: null }],
    ]);
  });

  it('refuses a file from a newer version', () => {
    expect(() => parseLayer(PREVIOUS_GRUND.replace('# Grund\n', `# Grund\n<!-- dagsljus-schema ${CONTEXT_SCHEMA + 1} -->\n`))).toThrow(/nyare version/);
  });
});

describe('the full backup', () => {
  it('reads a backup from the previous schema and migrates it', async () => {
    const s = emptySnapshot();
    const at = '2026-10-01T10:00:00.000Z';
    s.grund = { p1: { id: 'p1', layer: 'grund', kind: 'serious', text: 'Slutar äta', order: 0, origin: 'crisis_plan', createdAt: at, approvedAt: at } } as never;
    s.kv.schemaVersion = SCHEMA_VERSION - 1;
    const repo = await Repository.create(memoryBackend());
    await repo.importData({ format: EXPORT_FORMAT, version: 1, exportedAt: at, data: s });
    expect(repo.contextEntries('grund')[0].plan).toEqual({ kind: 'sign', polarity: 'both', severity: 'serious', observer: 'self' });
    expect(repo.kvGet('schemaVersion')).toBe(SCHEMA_VERSION);
    expect(repo.exportData().data.kv.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
