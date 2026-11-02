// Lägg in plan: the whole crisis plan as pasted text, PDF or .docx. Page headers are removed,
// the plan is split into blocks by its own headings, and each block gets its kind from the
// rules table. The person checks the blocks, chooses a kind for any heading the app does not
// know, and saves. Nothing is sent anywhere; the text as read in is kept to read later.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { blockLines, blocksFromRows, BLOCK_TEXT, diffPlans, TEMPLATE, type BlockChange, type BlockType, type ImportedBlock, type PlanBlock } from '../../core/plan/blocks';
import { stripPageFurniture } from '../../core/plan/headers';
import { draftFromPages } from '../../core/plan/importPlan';
import { linesFromDocx, linesFromPdf, linesFromText, type SourcePages } from '../../core/plan/source';
import { akutLevel } from '../../core/context/akut';
import { pickBinaryFile } from '../../platform/files';
import { ORIGINAL_KEY, planBlocks, savePlanBlocks } from '../../services/planBlocks';
import { replaceStandard, unconfirmedStandard } from '../../services/standard';
import { Button, Card, Chip, Field, P, Row, Screen, Section } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { colors, space, type } from '../theme';
import { offerSleepWindow } from './PlanScreen';

const EXAMPLE = `Tidiga varningstecken – uppvarvning
- Sover mindre än sex timmar
- Pratar fortare och avbryter

Tidiga varningstecken – nedstämdhet
- Svarar inte på sms
- Orkar inte laga mat

Livsstil och rutiner – varje dag
- Sömn 22:30–07:00
- Tar min medicin klockan 21

Livsstil och rutiner vid uppvarvning
- Undvik sociala situationer med fler än fyra personer
- Drick ingen alkohol

Det här gör jag vid tidiga tecken
1. Går och lägger mig före 23
2. Ringer min kontaktperson

Tecken på allvarlig försämring – nedstämdhet
- Slutar äta

Det här gör jag vid allvarlig försämring
1. Ringer mottagningen samma dag`;

const CHANGE_TEXT: Record<BlockChange['status'], string> = { new: 'Nytt block', changed: 'Ändrat', removed: 'Finns inte i den nya planen', same: 'Som förut' };

const FILE_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pdf', '.docx'];
const CHOICES = TEMPLATE.filter((t) => t.inTemplate || t.type === 'ignore');

interface Read {
  blocks: ImportedBlock[];
  removed: string[];
  original: string;
  sourceName: string | null;
  polarityWords: { up?: string; down?: string };
}

function readPages(pages: SourcePages, sourceName: string | null, furniture: string[] = []): Read {
  const draft = draftFromPages(pages, 'text', { furniture, sourceName });
  const original = stripPageFurniture(pages, furniture).lines.map((l) => (l.heading ? `\n${l.text}` : l.list ? `- ${l.text}` : l.text)).join('\n').trim();
  return { blocks: blocksFromRows(draft.rows), removed: draft.removed, original, sourceName, polarityWords: draft.polarityWords };
}

function BlockReview({ b, onType }: { b: ImportedBlock; onType: (t: BlockType) => void }) {
  const [choosing, setChoosing] = useState(b.type == null);
  const lines = blockLines(b.text);
  const akut = lines.filter((l) => akutLevel(l.text) != null).length;
  return (
    <Card style={{ borderColor: b.type == null ? colors.danger : colors.border, borderWidth: b.type == null ? 2 : 1 }}>
      <Text style={type.h2} accessibilityRole="header">{b.heading}</Text>
      <Text style={[type.small, { color: b.type == null ? colors.danger : colors.textMuted }]}>
        {b.type == null ? 'Appen känner inte igen rubriken. Välj vad blocket är.' : `Läses som: ${BLOCK_TEXT[b.type]}`}
      </Text>
      {lines.slice(0, 12).map((l, i) => <P key={i} style={{ marginTop: space.xs }}>{`• ${l.text}`}</P>)}
      {lines.length > 12 ? <P muted style={{ marginTop: space.xs }}>och {lines.length - 12} rader till</P> : null}
      {akut ? (
        <Text style={[type.small, { color: colors.danger, marginTop: space.xs }]}>
          {akut === 1 ? 'En rad' : `${akut} rader`} handlar om att inte vilja leva. De blir också dina akuta formuleringar.
        </Text>
      ) : null}
      {choosing ? (
        <Row style={{ marginTop: space.s, gap: 6 }}>
          {CHOICES.map((t) => (
            <Chip key={t.type} label={t.type === 'ignore' ? 'Spara inte' : t.heading} selected={b.type === t.type} onPress={() => { onType(t.type); setChoosing(false); }} />
          ))}
        </Row>
      ) : (
        <Button kind="ghost" title="Byt vad blocket är" onPress={() => setChoosing(true)} />
      )}
    </Card>
  );
}

export function PlanImportScreen() {
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
  const [text, setText] = useState('');
  const [read, setRead] = useState<Read | null>(null);
  const [busy, setBusy] = useState(false);
  const hadPlan = planBlocks(repo).some((b) => b.text.trim());

  const fromFile = async () => {
    const file = await pickBinaryFile(FILE_TYPES);
    if (!file) return;
    setBusy(true);
    try {
      const head = String.fromCharCode(...file.data.slice(0, 4));
      if (head.startsWith('%PDF')) {
        const pages = await linesFromPdf(file.data);
        if (!pages.some((p) => p.length)) throw new Error('PDF:en har ingen text. Är den inskannad? Använd telefonens textigenkänning och klistra in texten i stället.');
        setRead(readPages(pages, file.name));
      } else if (head.startsWith('PK')) {
        const doc = linesFromDocx(file.data);
        setRead(readPages(doc.pages, file.name, doc.furniture));
      } else throw new Error('Välj en PDF eller en Word-fil (.docx).');
    } catch (e) {
      await dialog.info('Filen gick inte att läsa', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!read) return;
    if (read.blocks.some((b) => b.type == null)) {
      await dialog.info('Välj för alla block', 'Några rubriker känner appen inte igen. Välj vad varje sådant block är, eller Spara inte.');
      return;
    }
    if (hadPlan) {
      const ok = await dialog.confirm({
        title: 'Ersätta din plan?',
        message: 'Den nya planen ersätter den gamla. Rader som står kvar ordagrant behåller sina påminnelser och sin historik.',
        confirmLabel: 'Ersätt planen',
      });
      if (!ok) return;
    }
    const blocks: PlanBlock[] = read.blocks.filter((b): b is PlanBlock => b.type != null && b.type !== 'ignore');
    const res = await savePlanBlocks(repo, blocks);
    await repo.kvSet(ORIGINAL_KEY, { text: read.original, sourceName: read.sourceName, at: new Date().toISOString() });
    if (read.polarityWords.up || read.polarityWords.down) await repo.updatePlanSettings({ polarityWords: { ...repo.planSettings().polarityWords, ...read.polarityWords } });
    if (unconfirmedStandard(repo).length) {
      const replace = await dialog.confirm({
        title: 'Ta bort standardraderna?',
        message: 'Din egen plan ersätter standardinnehållet. Standardrader du redan bekräftat ligger kvar.',
        confirmLabel: 'Ta bort standardraderna',
      });
      if (replace) await replaceStandard(repo);
    }
    await offerSleepWindow(repo, dialog, res.sleepWindow);
    await dialog.info('Sparat', `Planen är sparad med ${blocks.length} block och ${res.rows} rader.`);
    setRead(null);
    nav.replace({ name: 'plan' });
  };

  if (read) {
    const unknown = read.blocks.filter((b) => b.type == null).length;
    // Uppdaterad plan: what changes against the plan saved now, line by line.
    const changes = hadPlan
      ? diffPlans(planBlocks(repo), read.blocks.filter((b): b is PlanBlock => b.type != null)).filter((c) => c.status !== 'same')
      : [];
    return (
      <Screen title={hadPlan ? 'Uppdaterad plan' : 'Granska planen'} footer={<Button big title={hadPlan ? 'Spara den nya planen' : 'Spara planen'} onPress={save} />}>
        {unknown ? <P muted>{unknown === 1 ? 'Ett block' : `${unknown} block`} behöver att du väljer vad det är.</P> : null}
        {hadPlan ? (
          <Section title={changes.length ? 'Ändringar mot din nuvarande plan' : 'Inga ändringar mot din nuvarande plan'}>
            {changes.map((c) => (
              <Card key={c.heading + c.status}>
                <Text style={type.h2} accessibilityRole="header">{c.heading}</Text>
                <Text style={type.small}>{CHANGE_TEXT[c.status]}{c.kept ? `, ${c.kept} rader som förut` : ''}</Text>
                {c.added.map((l) => <Text key={`+${l}`} style={[type.body, { marginTop: space.xs, color: colors.green }]} accessibilityLabel={`Ny rad: ${l}`}>{`+ ${l}`}</Text>)}
                {c.removed.map((l) => <Text key={`-${l}`} style={[type.body, { marginTop: space.xs, color: colors.danger, textDecorationLine: 'line-through' }]} accessibilityLabel={`Borttagen rad: ${l}`}>{`− ${l}`}</Text>)}
              </Card>
            ))}
          </Section>
        ) : null}

        {read.removed.length ? (
          <Section title="Borttaget sidhuvud">
            <Card>
              <P muted>Sparas inte.</P>
              {read.removed.map((r) => <Text key={r} style={[type.small, { marginTop: space.xs, textDecorationLine: 'line-through' }]}>{r}</Text>)}
            </Card>
          </Section>
        ) : null}
        {read.blocks.map((b, i) => (
          <View key={b.id} style={{ marginTop: space.m }}>
            <BlockReview b={b} onType={(t) => setRead((r) => r && { ...r, blocks: r.blocks.map((x, k) => (k === i ? { ...x, type: t } : x)) })} />
          </View>
        ))}
        <Button kind="ghost" title="‹ Tillbaka" onPress={() => setRead(null)} />
      </Screen>
    );
  }

  return (
    <Screen
      title="Lägg in plan"
      footer={
        <>
          <Button big title="Läs in texten" disabled={!text.trim() || busy} onPress={() => setRead(readPages(linesFromText(text), null))} />
          <Button kind="secondary" title="Välj PDF eller Word-fil" onPress={fromFile} busy={busy} />
        </>
      }
    >
      <P muted>Planen läses på telefonen. Inget skickas någonstans.</P>
      <Field value={text} onChangeText={setText} multiline placeholder="Klistra in planen här…" accessibilityLabel="Planens text" style={{ minHeight: 220, marginTop: space.m }} />
      <Button kind="ghost" title="Fyll i ett exempel" onPress={() => setText(EXAMPLE)} />
    </Screen>
  );
}
