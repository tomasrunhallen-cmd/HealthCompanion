import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { eveningDateKey, formatDateSv } from '../../analysis/dates';
import { buildContext } from '../../context/buildContext';
import { KIND_TEXT, LAYER_TEXT, ORIGIN_TEXT } from '../../context/labels';
import type { ContextEntry, ContextKind, ContextLayer, Entry } from '../../domain/types';
import { Button, Card, Chip, Field, P, Row, Screen, Section } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { colors, space, type } from '../theme';

/** Kinds the user adds here. Plan rows are added under Min krisplan; corrections after an assessment. */
const ADDABLE: Record<ContextLayer, ContextKind[]> = {
  grund: ['trigger', 'false_alarm', 'medication', 'tone_yellow', 'tone_red'],
  profil: ['typical_phrase', 'period_low', 'period_high', 'period_mixed', 'course'],
  dagligt: ['event'],
};

const KIND_ORDER: ContextKind[] = [
  'early', 'serious', 'action_yellow', 'action_red', 'relatives', 'akut', 'trigger', 'false_alarm', 'medication',
  'tone_yellow', 'tone_red', 'normal_state', 'course', 'period_high', 'period_low', 'period_mixed', 'typical_phrase',
  'event', 'medication_taken', 'correction',
];

function short(iso: string | null | undefined): string {
  return iso ? formatDateSv(iso.slice(0, 10)) : '';
}

function EntryRow({ e }: { e: ContextEntry }) {
  const repo = useRepo();
  const dialog = useDialog();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(e.text);
  const isAkut = e.kind === 'akut';
  const detail = [
    ORIGIN_TEXT[e.origin],
    e.origin === 'standard' && !e.approvedAt ? 'inte bekräftad' : null,
    e.date ? formatDateSv(e.date) : null,
    e.kind === 'medication_taken' ? (e.taken ? 'tagen' : 'inte tagen') : null,
    e.kind === 'correction' ? (e.correction?.verdict === 'agree' ? 'stämde' : 'stämde inte') : null,
    `skapad ${short(e.createdAt)}`,
    e.approvedAt && e.approvedAt !== e.createdAt ? `godkänd ${short(e.approvedAt)}` : null,
  ].filter(Boolean).join(' · ');

  if (editing) {
    return (
      <View style={{ paddingVertical: space.s, borderBottomWidth: 1, borderColor: colors.border }}>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: space.s, fontSize: 16, color: colors.text, backgroundColor: colors.surface }}
        />
        <Row>
          <Button
            title="Spara"
            onPress={async () => {
              // Editing makes it the user's own words.
              await repo.updateContextEntry(e.id, { text: text.trim(), origin: e.origin === 'correction' ? 'correction' : 'user', approvedAt: new Date().toISOString() });
              setEditing(false);
            }}
          />
          <Button kind="ghost" title="Avbryt" onPress={() => { setText(e.text); setEditing(false); }} />
        </Row>
      </View>
    );
  }
  return (
    <View style={{ paddingVertical: space.s, borderBottomWidth: 1, borderColor: colors.border }}>
      <P>{e.text || (e.kind === 'correction' ? '(ingen kommentar)' : e.kind === 'medication_taken' ? 'Medicin' : '')}</P>
      <Text style={[type.small, { marginTop: 2 }]}>{detail}</Text>
      {isAkut ? <Text style={[type.small, { marginTop: 2 }]}>Skickas aldrig till en språkmodell.</Text> : null}
      <Row style={{ marginTop: space.xs, gap: space.l }}>
        {e.kind !== 'medication_taken' ? (
          <Pressable onPress={() => setEditing(true)} hitSlop={8}><Text style={link}>Ändra</Text></Pressable>
        ) : null}
        <Pressable
          hitSlop={8}
          onPress={async () => {
            const ok = await dialog.confirm({ title: 'Radera posten?', message: e.text || KIND_TEXT[e.kind], confirmLabel: 'Radera', danger: true });
            if (ok) await repo.removeContextEntry(e.id);
          }}
        >
          <Text style={[link, { color: colors.danger }]}>Radera</Text>
        </Pressable>
      </Row>
    </View>
  );
}

const link = { color: colors.accent, fontWeight: '600' as const, fontSize: 14 };

function AddEntry({ layer }: { layer: ContextLayer }) {
  const repo = useRepo();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ContextKind>(ADDABLE[layer][0]);
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const dateOk = kind !== 'event' || /^\d{4}-\d{2}-\d{2}$/.test(date);
  if (!open) return <Button kind="ghost" title={`+ Lägg till i ${LAYER_TEXT[layer].title.toLowerCase()}`} onPress={() => setOpen(true)} />;
  return (
    <View style={{ marginTop: space.s }}>
      <Row style={{ gap: 6, marginBottom: space.s }}>
        {ADDABLE[layer].map((k) => <Chip key={k} label={KIND_TEXT[k]} selected={kind === k} onPress={() => setKind(k)} />)}
      </Row>
      {kind === 'event' ? <Field label="DATUM (ÅÅÅÅ-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-11-20" /> : null}
      <Field value={text} onChangeText={setText} multiline placeholder={KIND_TEXT[kind]} style={{ minHeight: 60 }} />
      <Row>
        <Button
          title="Spara"
          disabled={!text.trim() || !dateOk}
          onPress={async () => {
            await repo.addContextEntry({ kind, text, origin: 'user', ...(kind === 'event' ? { date } : {}) });
            setText('');
            setDate('');
            setOpen(false);
          }}
        />
        <Button kind="ghost" title="Avbryt" onPress={() => setOpen(false)} />
      </Row>
    </View>
  );
}

export function KnowledgeScreen() {
  const repo = useRepo();
  const nav = useNav();
  const pending = repo.pendingSuggestions().length;
  const info = repo.storageInfo();
  const today = eveningDateKey(new Date());
  const probe: Entry = {
    id: 'probe', date: today, createdAt: new Date().toISOString(), kind: 'checkin', transcript: '', mood: null, energy: null,
    wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null,
  };
  const derived = buildContext({ entries: repo.contextEntries(), entry: probe, history: repo.history(), garmin: repo.garminDays() }).variables.dagligt;

  return (
    <Screen title="Det appen vet om mig" back>
      <P muted>
        Allt appen vet om dig finns här, och bara här: {info.kind === 'cloud' ? 'i ditt Firebase-projekt' : 'på den här enheten'}.
        Ingenting lärs in i språkmodellen. Byter du modell finns allt kvar. Appen ändrar aldrig något utan att du godkänt det.
      </P>

      {pending ? (
        <Pressable onPress={() => nav.push({ name: 'suggestions' })} accessibilityRole="button">
          <Card tone="accent" style={{ marginTop: space.m }}>
            <Text style={type.h2}>{pending === 1 ? 'Ett förslag väntar' : `${pending} förslag väntar`}</Text>
            <Text style={[type.small, { marginTop: space.xs, color: colors.accent, fontWeight: '600' }]}>Granska ›</Text>
          </Card>
        </Pressable>
      ) : null}

      {(['grund', 'profil', 'dagligt'] as ContextLayer[]).map((layer) => {
        const entries = repo.contextEntries(layer);
        const kinds = KIND_ORDER.filter((k) => entries.some((e) => e.kind === k));
        return (
          <Section key={layer} title={LAYER_TEXT[layer].title}>
            <P muted style={{ marginBottom: space.s }}>{LAYER_TEXT[layer].help}</P>
            {layer === 'grund' ? (
              <Button kind="secondary" title="Krisplanens tecken och åtgärder: Min krisplan" onPress={() => nav.push({ name: 'plan' })} />
            ) : null}
            <Card>
              {kinds.length === 0 ? <P muted>Inget här än.</P> : null}
              {kinds.map((k) => (
                <View key={k} style={{ marginBottom: space.s }}>
                  <Text style={type.label}>{KIND_TEXT[k].toUpperCase()}</Text>
                  {entries
                    .filter((e) => e.kind === k)
                    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.order - b.order)
                    .map((e) => <EntryRow key={e.id} e={e} />)}
                </View>
              ))}
              <AddEntry layer={layer} />
            </Card>
            {layer === 'dagligt' ? (
              <Card>
                <Text style={type.label}>RÄKNAS FRAM UR DINA ANTECKNINGAR</Text>
                <P muted style={{ marginTop: space.xs }}>{derived}</P>
                <P muted style={{ marginTop: space.xs }}>Dagens anteckning och mätvärden sparas med varje avstämning, under Alla dagar.</P>
              </Card>
            ) : null}
          </Section>
        );
      })}
    </Screen>
  );
}
