import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { PlanItem, PlanItemKind } from '../../domain/types';
import { KIND_LABEL } from '../../plan/parsePlan';
import { Button, Card, Field, P, Row, Screen, Section } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { colors, space, type } from '../theme';
import { newId } from '../../analysis/assess';

const KINDS: { kind: PlanItemKind; title: string; help: string }[] = [
  { kind: 'early', title: 'Tidiga tecken', help: 'Ger gult när de matchar.' },
  { kind: 'serious', title: 'Allvarliga tecken', help: 'Ger rött tillsammans med ett annat tecken.' },
  { kind: 'action_yellow', title: 'Åtgärder vid gult', help: 'Den första är ditt första steg.' },
  { kind: 'action_red', title: 'Åtgärder vid rött', help: 'Den första visas som rekommendation vid rött.' },
  { kind: 'relatives', title: 'Vad anhöriga gör', help: 'Visas bara för dig. Appen kontaktar ingen.' },
];

function ItemRow({ item, first, last }: { item: PlanItem; first: boolean; last: boolean }) {
  const repo = useRepo();
  const dialog = useDialog();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);

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
          <Button title="Spara" onPress={async () => { if (text.trim()) await repo.updatePlanItem(item.id, text); setEditing(false); }} />
          <Button title="Avbryt" kind="ghost" onPress={() => { setText(item.text); setEditing(false); }} />
        </Row>
      </View>
    );
  }
  return (
    <View style={{ paddingVertical: space.s, borderBottomWidth: 1, borderColor: colors.border }}>
      <P>{item.text}</P>
      <Row style={{ marginTop: space.xs, gap: space.l }}>
        <Pressable onPress={() => setEditing(true)} hitSlop={8}><Text style={link}>Ändra</Text></Pressable>
        {!first && <Pressable onPress={() => repo.movePlanItem(item.id, -1)} hitSlop={8}><Text style={link}>Upp</Text></Pressable>}
        {!last && <Pressable onPress={() => repo.movePlanItem(item.id, 1)} hitSlop={8}><Text style={link}>Ner</Text></Pressable>}
        <Pressable
          hitSlop={8}
          onPress={async () => {
            const ok = await dialog.confirm({ title: 'Ta bort raden?', message: item.text, confirmLabel: 'Ta bort', danger: true });
            if (ok) await repo.removePlanItem(item.id);
          }}
        >
          <Text style={[link, { color: colors.danger }]}>Ta bort</Text>
        </Pressable>
      </Row>
    </View>
  );
}

const link = { color: colors.accent, fontWeight: '600' as const, fontSize: 14 };

function AddRow({ kind }: { kind: PlanItemKind }) {
  const repo = useRepo();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  if (!open) return <Button kind="ghost" title="+ Lägg till rad" onPress={() => setOpen(true)} />;
  return (
    <View style={{ marginTop: space.s }}>
      <Field value={text} onChangeText={setText} placeholder={`Ny rad: ${KIND_LABEL[kind].toLowerCase()}`} />
      <Row>
        <Button
          title="Godkänn och spara"
          disabled={!text.trim()}
          onPress={async () => { await repo.addPlanItems([{ id: newId('p'), kind, text }]); setText(''); setOpen(false); }}
        />
        <Button title="Avbryt" kind="ghost" onPress={() => setOpen(false)} />
      </Row>
    </View>
  );
}

export function PlanScreen() {
  const repo = useRepo();
  const nav = useNav();
  const ps = repo.planSettings();
  const [normal, setNormal] = useState(ps.normalState);
  const [threshold, setThreshold] = useState(ps.sleepThresholdHours);

  return (
    <Screen title="Min krisplan" back>
      <P muted>
        Planen är källan. Appen använder bara de tecken och åtgärder som står här, med dina egna ord.
      </P>
      <Button title="Importera eller klistra in plan" kind="secondary" onPress={() => nav.push({ name: 'planImport' })} style={{ marginTop: space.m }} />

      {KINDS.map(({ kind, title, help }) => {
        const items = repo.planOf(kind);
        return (
          <Section key={kind} title={title}>
            <Card>
              <P muted>{help}</P>
              {items.length === 0 ? <P muted style={{ marginTop: space.s }}>Inga rader ännu.</P> : null}
              {items.map((item, i) => (
                <ItemRow key={item.id + item.text} item={item} first={i === 0} last={i === items.length - 1} />
              ))}
              <AddRow kind={kind} />
            </Card>
          </Section>
        );
      })}

      <Section title="Normalläge och sömn">
        <Card>
          <Field
            label="SÅ HÄR ÄR JAG NÄR JAG MÅR SOM VANLIGT"
            value={normal}
            onChangeText={setNormal}
            onBlur={() => repo.updatePlanSettings({ normalState: normal })}
            multiline
            placeholder="Till exempel: sover sju timmar, jobbar dagtid, träffar vänner på helgen."
          />
          <Text style={type.label}>SÖMNGRÄNS</Text>
          <Row style={{ marginTop: space.xs }}>
            <Button kind="secondary" title="−" onPress={() => { const v = Math.max(2, threshold - 0.5); setThreshold(v); repo.updatePlanSettings({ sleepThresholdHours: v }); }} />
            <Text style={[type.h2, { minWidth: 80, textAlign: 'center' }]}>{threshold} h</Text>
            <Button kind="secondary" title="+" onPress={() => { const v = Math.min(10, threshold + 0.5); setThreshold(v); repo.updatePlanSettings({ sleepThresholdHours: v }); }} />
          </Row>
          <P muted>Sömn under gränsen räknas som ett tidigt tecken. Standard är 5 timmar.</P>
        </Card>
      </Section>
    </Screen>
  );
}
