// Mina tidigare texter: the person's earlier texts, each with its period, how it was labelled,
// what kind of text it is and whether it may be used. Experimental, for personal use. The
// texts are historical data: they never decide anything on their own.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { LabelSource, PeriodType, ReferenceText, ReferenceTextType } from '../../core/domain/types';
import {
  EXCLUDED_TEXT, LABEL_SOURCE_TEXT, PERIOD_TEXT, TEXT_TYPE_TEXT, excludedBecause, stableCount,
} from '../../core/references/references';
import { pickTextFiles, saveExportFile } from '../../platform/files';
import {
  exportReferences, importReferenceFiles, referenceTexts, removeReference, saveReference, setReferenceUse, type ReferenceDraft,
} from '../../services/references';
import { Button, Card, Chip, Field, P, Row, Screen, Section, Segmented, Toggle } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { colors, space, type } from '../theme';

const PERIODS: PeriodType[] = ['stable', 'up', 'down', 'mixed', 'unsure'];
const TYPES: ReferenceTextType[] = ['diary', 'message', 'work', 'other'];

const EMPTY: ReferenceDraft = {
  text: '', approxDate: null, periodId: '', periodType: 'unsure', labelSource: 'self_after', textType: 'diary', comment: null, useInAnalysis: true,
};

function RefForm({ initial, onDone }: { initial: ReferenceDraft; onDone: () => void }) {
  const repo = useRepo();
  const [d, setD] = useState<ReferenceDraft>(initial);
  const set = (patch: Partial<ReferenceDraft>) => setD((x) => ({ ...x, ...patch }));
  const ready = d.text.trim() && d.periodId.trim();
  return (
    <Card>
      <Field label="TEXT" value={d.text} onChangeText={(text) => set({ text })} multiline placeholder="Klistra in en text du skrivit" accessibilityLabel="Text" />
      <Field label="UNGEFÄRLIGT DATUM" value={d.approxDate ?? ''} onChangeText={(v) => set({ approxDate: v.trim() || null })} placeholder="2024-03" accessibilityLabel="Ungefärligt datum" />
      <Field label="PERIOD" value={d.periodId} onChangeText={(periodId) => set({ periodId })} placeholder="Till exempel: våren 2024" accessibilityLabel="Period" hint="Samma namn för texter från samma period." />
      <Text style={type.label}>SORTS PERIOD</Text>
      <Row style={{ marginTop: space.xs, gap: 6 }}>
        {PERIODS.map((p) => <Chip key={p} label={PERIOD_TEXT[p]} selected={d.periodType === p} onPress={() => set({ periodType: p })} />)}
      </Row>
      <Segmented<LabelSource>
        label="MÄRKNINGEN"
        value={d.labelSource}
        onChange={(labelSource) => set({ labelSource })}
        options={[{ value: 'self_after', label: 'Egen, i efterhand' }, { value: 'with_care', label: 'Med vården' }]}
      />
      <Text style={[type.label, { marginTop: space.m }]}>SORTS TEXT</Text>
      <Row style={{ marginTop: space.xs, gap: 6 }}>
        {TYPES.map((t) => <Chip key={t} label={TEXT_TYPE_TEXT[t]} selected={d.textType === t} onPress={() => set({ textType: t })} />)}
      </Row>
      <View style={{ marginTop: space.m }}>
        <Field label="SAMMANHANG (VALFRITT)" value={d.comment ?? ''} onChangeText={(v) => set({ comment: v })} placeholder="Till exempel: skrivet till en kollega" accessibilityLabel="Sammanhang" />
      </View>
      <Toggle label="Får användas i analysen" value={d.useInAnalysis} onChange={(useInAnalysis) => set({ useInAnalysis })} />
      <Row style={{ marginTop: space.s }}>
        <Button title="Spara" disabled={!ready} onPress={async () => { await saveReference(repo, d); onDone(); }} />
        <Button kind="ghost" title="Avbryt" onPress={onDone} />
      </Row>
    </Card>
  );
}

function RefCard({ r }: { r: ReferenceText }) {
  const repo = useRepo();
  const dialog = useDialog();
  const [editing, setEditing] = useState(false);
  if (editing) return <RefForm initial={r} onDone={() => setEditing(false)} />;
  const out = excludedBecause(r);
  return (
    <Card>
      <Text style={[type.body, { fontWeight: '600' }]}>{PERIOD_TEXT[r.periodType]} · {r.periodId}</Text>
      <Text style={type.small}>
        {[r.approxDate ? `ca ${r.approxDate}` : 'okänt datum', TEXT_TYPE_TEXT[r.textType], LABEL_SOURCE_TEXT[r.labelSource].toLowerCase()].join(' · ')}
      </Text>
      <P style={{ marginTop: space.xs }}>{r.text.length > 240 ? `${r.text.slice(0, 240)} …` : r.text}</P>
      {r.comment ? <Text style={[type.small, { marginTop: space.xs }]}>{r.comment}</Text> : null}
      {out && out !== 'off' ? <Text style={[type.small, { marginTop: space.xs, color: out === 'akut' ? colors.danger : colors.textMuted }]}>{EXCLUDED_TEXT[out]}</Text> : null}
      <Toggle label="Får användas i analysen" value={r.useInAnalysis} onChange={(v) => setReferenceUse(repo, r.id, v)} />
      <Row>
        <Button kind="ghost" title="Ändra" label={`Ändra texten från ${r.periodId}`} onPress={() => setEditing(true)} />
        <Button kind="ghost" title="Ta bort" label={`Ta bort texten från ${r.periodId}`} onPress={async () => {
          const ok = await dialog.confirm({
            title: 'Ta bort texten?',
            message: 'Mönster som bara bygger på den tas bort. Mönster med andra källor kvar måste godkännas igen.',
            confirmLabel: 'Ta bort', danger: true,
          });
          if (ok) await removeReference(repo, r.id);
        }} />
      </Row>
    </Card>
  );
}

export function ReferencesScreen() {
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
  const [adding, setAdding] = useState(false);
  const [importType, setImportType] = useState<ReferenceTextType>('diary');
  const [ownName, setOwnName] = useState(repo.settings().ownMessageName ?? '');
  const refs = referenceTexts(repo);
  const stable = stableCount(refs);

  const doImport = async () => {
    const files = await pickTextFiles(['.txt', 'text/plain']);
    if (!files.length) return;
    if (importType === 'message') await repo.updateSettings({ ownMessageName: ownName.trim() || null });
    const r = await importReferenceFiles(repo, files, { textType: importType, ownName });
    await dialog.info(
      'Importerat',
      `${r.added === 1 ? 'En text' : `${r.added} texter`} lades till${r.droppedLines ? `, utan ${r.droppedLines} rader från andra personer` : ''}. ` +
        'De används inte förrän du märkt perioden och slagit på Får användas i analysen.',
    );
  };

  return (
    <Screen title="Tidigare texter">
      <P muted>Experimentellt, för eget bruk. Texterna kan påverka bedömningen när du godkänt mönster och slagit på jämförelsen.</P>
      <Card style={{ marginTop: space.m }}>
        <P>{refs.length === 1 ? 'En text' : `${refs.length} texter`}, varav {stable} från stabila perioder.</P>
        {refs.length && !stable ? (
          <Text style={[type.small, { marginTop: space.xs }]}>Lägg gärna till texter från stabila perioder. Utan dem blir jämförelsen osäker.</Text>
        ) : null}
        <Button kind="secondary" title="Mönster och jämförelse" onPress={() => nav.push({ name: 'textPatterns' })} />
      </Card>

      {adding ? <RefForm initial={EMPTY} onDone={() => setAdding(false)} /> : <Button title="Lägg till text" onPress={() => setAdding(true)} />}

      <Section title="Importera textfiler">
        <Card>
          <Row style={{ gap: 6 }}>
            {TYPES.map((t) => <Chip key={t} label={TEXT_TYPE_TEXT[t]} selected={importType === t} onPress={() => setImportType(t)} />)}
          </Row>
          {importType === 'message' ? (
            <View style={{ marginTop: space.s }}>
              <Field label="DITT NAMN I FILEN" value={ownName} onChangeText={setOwnName} placeholder="Som det står före dina meddelanden" accessibilityLabel="Ditt namn i filen" hint="Bara dina egna rader tas med." />
            </View>
          ) : null}
          <Button kind="secondary" title="Välj textfiler" onPress={doImport} />
        </Card>
      </Section>

      <Section title="Texterna">
        {refs.length ? refs.map((r) => <RefCard key={r.id} r={r} />) : <P muted>Inga texter än.</P>}
      </Section>

      <Button kind="ghost" title="Exportera texter och mönster" onPress={async () => {
        const ok = await dialog.confirm({ title: 'Exportera?', message: 'Filen är inte krypterad. Spara den där bara du kommer åt den.', confirmLabel: 'Exportera' });
        if (ok) await saveExportFile('mina-tidigare-texter.json', exportReferences(repo));
      }} />
    </Screen>
  );
}
