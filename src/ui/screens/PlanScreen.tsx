// Min krisplan: the plan as text blocks under the usual headings. The person writes one thing
// per line in their own words; the app makes the rows it needs from the lines. Signs give
// points, routines are ticked off, the steps show in Hjälp nu.

import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { newId } from '../../core/analysis/assess';
import { blockLines, isSignBlock, TEMPLATE, BLOCK_TEXT, type BlockType, type PlanBlock } from '../../core/plan/blocks';
import { windowHours } from '../../core/plan/importPlan';
import type { PlanItem } from '../../core/domain/types';
import { planBlocks, removeBlock, saveBlock } from '../../services/planBlocks';
import { confirmStandard, unconfirmedStandard } from '../../services/standard';
import { Button, Card, Chip, Field, P, Row, Screen, Section, Segmented } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { colors, MIN_TOUCH, space, type } from '../theme';

const PRIVATE: BlockType[] = ['contacts', 'wishes', 'care'];

/** After a save: a sleep window in the routines is offered for the sleep rule, never applied without a yes. */
export async function offerSleepWindow(
  repo: ReturnType<typeof useRepo>,
  dialog: ReturnType<typeof useDialog>,
  sleep: { start: string; end: string; text: string } | null,
): Promise<void> {
  if (!sleep) return;
  const limit = Math.max(4, Math.round((windowHours(sleep.start, sleep.end) - 2) * 2) / 2);
  const now = repo.planSettings().sleepThresholdHours;
  const use = await dialog.confirm({
    title: `Använda sömnfönstret ${sleep.start}–${sleep.end}?`,
    message:
      `Planen säger ”${sleep.text}”. Appen kan räkna sömn under ${String(limit).replace('.', ',')} timmar som ett tidigt tecken, ` +
      `i stället för ${String(now).replace('.', ',')} timmar i dag. Gränsen är fönstret minus två timmar. Det är appens tolkning, ` +
      'inte planens, och du kan ändra den här under Sömngräns.',
    confirmLabel: 'Använd sömnfönstret',
  });
  if (use) await repo.updatePlanSettings({ sleepWindow: { start: sleep.start, end: sleep.end }, sleepThresholdHours: limit });
}

function BlockCard({ block, template }: { block: PlanBlock; template: boolean }) {
  const repo = useRepo();
  const dialog = useDialog();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(block.text);
  const [heading, setHeading] = useState(block.heading);
  const [typeOf, setTypeOf] = useState<BlockType>(block.type);
  const lines = blockLines(block.text);
  const hint = TEMPLATE.find((t) => t.type === block.type)?.hint ?? '';

  const save = async () => {
    const res = await saveBlock(repo, { ...block, text, heading: heading.trim() || block.heading, type: typeOf });
    setEditing(false);
    await offerSleepWindow(repo, dialog, res.sleepWindow);
  };

  return (
    <Card>
      <Text style={type.h2} accessibilityRole="header">{block.heading}</Text>
      {!template ? <Text style={type.small}>Läses som: {BLOCK_TEXT[block.type]}</Text> : null}
      {PRIVATE.includes(block.type) ? <Text style={type.small}>Används aldrig i bedömningen och skickas aldrig till en språkmodell.</Text> : null}
      {editing ? (
        <View style={{ marginTop: space.s }}>
          {!template ? (
            <>
              <Field label="RUBRIK" value={heading} onChangeText={setHeading} />
              <Text style={type.label}>VAD ÄR BLOCKET?</Text>
              <Row style={{ marginTop: space.xs, marginBottom: space.m, gap: 6 }}>
                {TEMPLATE.filter((t) => t.type !== 'normal').map((t) => (
                  <Chip key={t.type} label={t.heading} selected={typeOf === t.type} onPress={() => setTypeOf(t.type)} />
                ))}
              </Row>
            </>
          ) : null}
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            accessibilityLabel={`Text under ${block.heading}`}
            placeholder={hint}
            placeholderTextColor={colors.textMuted}
            style={{ minHeight: 140, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space.m, fontSize: 17, color: colors.text, backgroundColor: colors.surface, textAlignVertical: 'top' }}
          />
          <Text style={[type.small, { marginTop: space.xs }]}>En sak per rad. Dina egna ord.</Text>
          <Row style={{ marginTop: space.s }}>
            <Button title="Spara" onPress={save} />
            <Button kind="ghost" title="Avbryt" onPress={() => { setText(block.text); setHeading(block.heading); setTypeOf(block.type); setEditing(false); }} />
          </Row>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={lines.length ? `${block.heading}: ${lines.map((l) => l.text).join('. ')}. Ändra.` : `${block.heading}: tomt. Skriv.`}
          onPress={() => setEditing(true)}
          style={{ marginTop: space.s, minHeight: MIN_TOUCH }}
        >
          {lines.length ? (
            lines.map((l, i) => <P key={i} style={{ marginTop: i ? space.xs : 0 }}>{`• ${l.text}`}</P>)
          ) : (
            <P muted>{hint}</P>
          )}
          <Text style={{ color: colors.accent, fontWeight: '600', marginTop: space.s }}>{lines.length ? 'Ändra' : 'Skriv'}</Text>
        </Pressable>
      )}
      {isSignBlock(block.type) && lines.length ? (
        <Segmented
          label="Vem märker tecknen"
          value={block.observer ?? 'self'}
          onChange={(observer) => saveBlock(repo, { ...block, observer })}
          options={[{ value: 'self', label: 'Jag märker' }, { value: 'others', label: 'Andra ser' }]}
        />
      ) : null}
      {!template && !editing ? (
        <Button kind="ghost" title="Ta bort blocket" onPress={async () => {
          const ok = await dialog.confirm({ title: 'Ta bort blocket?', message: block.heading, confirmLabel: 'Ta bort', danger: true });
          if (ok) await removeBlock(repo, block.id);
        }} />
      ) : null}
    </Card>
  );
}

function AkutRow({ item }: { item: PlanItem }) {
  const repo = useRepo();
  const dialog = useDialog();
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: space.xs, flexWrap: 'nowrap' }}>
      <P style={{ flex: 1 }}>{item.text}</P>
      <Button kind="ghost" title="Ta bort" onPress={async () => {
        const ok = await dialog.confirm({ title: 'Ta bort formuleringen?', message: item.text, confirmLabel: 'Ta bort', danger: true });
        if (ok) await repo.removePlanItem(item.id);
      }} />
    </Row>
  );
}

export function PlanScreen() {
  const repo = useRepo();
  const nav = useNav();
  const blocks = planBlocks(repo);
  const ps = repo.planSettings();
  const [threshold, setThreshold] = useState(ps.sleepThresholdHours);
  const [akut, setAkut] = useState('');
  const standard = unconfirmedStandard(repo);
  const templateIds = new Set(TEMPLATE.filter((t) => t.inTemplate).map((t) => t.heading));
  const hasText = blocks.some((b) => b.text.trim());

  return (
    <Screen title="Min krisplan" back>
      <P muted>
        Din krisplan i textform, med samma rubriker som i vårdens krisplaner. Skriv en sak per rad, med dina egna ord. Tecknen ger
        poäng i bedömningen, rutinerna bockar du av under dagen och stegen visas i Hjälp nu.
      </P>
      <Button title={hasText ? 'Planen har uppdaterats hos vården' : 'Klistra in eller läs in din plan'} kind="secondary" onPress={() => nav.push({ name: 'planImport' })} style={{ marginTop: space.m }} />

      {standard.length ? (
        <Card tone="accent">
          <P>Du använder {standard.length} rader standardinnehåll. De kan bara ge gult tills du bekräftar dem eller skriver din egen plan.</P>
          {standard.map((e) => (
            <Row key={e.id} style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <P style={{ flex: 1 }}>{e.text}</P>
              <Button kind="ghost" title="Bekräfta" onPress={() => confirmStandard(repo, e.id)} />
            </Row>
          ))}
        </Card>
      ) : null}

      {blocks.filter((b) => b.type !== 'ignore').map((b) => (
        <View key={b.id + b.updatedAt} style={{ marginTop: space.m }}>
          <BlockCard block={b} template={templateIds.has(b.heading) && b.id.startsWith('b_') && TEMPLATE.some((t) => t.type === b.type && t.heading === b.heading)} />
        </View>
      ))}
      <Button kind="ghost" title="+ Lägg till ett eget block" onPress={() => saveBlock(repo, { id: newId('b'), type: 'routine', heading: 'Eget block', text: '', updatedAt: new Date().toISOString() })} />

      <Section title="Akuta formuleringar">
        <Card>
          <P muted>Dina egna ord för att inte vilja leva eller skada dig. Står de i en anteckning visas krisnumren direkt. De skickas aldrig till en språkmodell.</P>
          {repo.planOf('akut').map((p) => <AkutRow key={p.id} item={p} />)}
          <Field value={akut} onChangeText={setAkut} placeholder="Ny formulering" accessibilityLabel="Ny akut formulering" />
          <Button title="Lägg till" disabled={!akut.trim()} onPress={async () => { await repo.addPlanItems([{ id: newId('p'), kind: 'akut', text: akut }]); setAkut(''); }} />
        </Card>
      </Section>

      <Section title="Sömngräns">
        <Card>
          <Row>
            <Button kind="secondary" title="−" onPress={() => { const v = Math.max(2, threshold - 0.5); setThreshold(v); repo.updatePlanSettings({ sleepThresholdHours: v }); }} />
            <Text style={[type.h2, { minWidth: 80, textAlign: 'center' }]} accessibilityLabel={`Sömngräns ${threshold} timmar`}>{String(threshold).replace('.', ',')} h</Text>
            <Button kind="secondary" title="+" onPress={() => { const v = Math.min(10, threshold + 0.5); setThreshold(v); repo.updatePlanSettings({ sleepThresholdHours: v }); }} />
          </Row>
          <P muted>Sömn under gränsen räknas som ett tidigt tecken. Standard är 5 timmar.</P>
          {ps.sleepWindow ? <P muted style={{ marginTop: space.s }}>Planens sömnfönster: {ps.sleepWindow.start}–{ps.sleepWindow.end}.</P> : null}
        </Card>
      </Section>

      <Button kind="ghost" title="Rutiner: påminnelser" onPress={() => nav.push({ name: 'routines' })} />
    </Screen>
  );
}
