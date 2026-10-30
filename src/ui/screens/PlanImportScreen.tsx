import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { PROVIDERS } from '../../adapter/providers';
import type { LlmAdapter } from '../../adapter/types';
import { newId } from '../../analysis/assess';
import type { PlanItemKind } from '../../domain/types';
import { KIND_LABEL, KIND_ORDER, parsePlanText, type DraftKind, type DraftRow } from '../../plan/parsePlan';
import { namesFromPlanText, scrubReversible } from '../../privacy/scrub';
import { activeAdapter, structurePlanWithModel, trackedCompleter } from '../../services/llm';
import { Button, Card, Chip, Field, P, Row, Screen, Section } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { colors, space, type } from '../theme';

const EXAMPLE = `Tidiga tecken
- Sover mindre än sex timmar
- Svarar inte på sms
- Handlar saker jag inte behöver

Allvarliga tecken
- Slutar äta
- Känner att andra är emot mig

Vid gult
- Gå och lägg dig före 23
- Ring Kim

Vid rött
- Ring mottagningen

Anhöriga
- Fråga hur jag sover

Normalläge: sover sju timmar, jobbar dagtid`;

/** The scrubbed text with every placeholder highlighted, so the user sees what is removed. */
function MarkedText({ text }: { text: string }) {
  const parts = text.split(/(\[[A-ZÅÄÖ-]+\d+\])/g);
  return (
    <Text style={type.body}>
      {parts.map((part, i) =>
        /^\[[A-ZÅÄÖ-]+\d+\]$/.test(part) ? (
          <Text key={i} style={{ backgroundColor: colors.accentSoft, color: colors.accent, fontWeight: '700' }}>{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        ),
      )}
    </Text>
  );
}

function DraftEditor({ row, onChange, warning }: { row: DraftRow; onChange: (r: DraftRow) => void; warning?: string }) {
  return (
    <Card style={{ borderColor: row.approved ? colors.green : colors.border, borderWidth: row.approved ? 2 : 1 }}>
      {warning ? <Text style={[type.small, { color: colors.danger, marginBottom: space.xs }]}>{warning}</Text> : null}
      <TextInput
        value={row.text}
        onChangeText={(text) => onChange({ ...row, text, approved: false })}
        multiline
        style={{ fontSize: 16, color: colors.text, padding: 0, marginBottom: space.s }}
      />
      <Row style={{ gap: 6 }}>
        {KIND_ORDER.filter((k) => k !== 'unsorted').map((k) => (
          <Chip key={k} label={KIND_LABEL[k]} selected={row.kind === k} onPress={() => onChange({ ...row, kind: k, approved: false })} />
        ))}
      </Row>
      <Row style={{ marginTop: space.m, justifyContent: 'space-between' }}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: row.approved, disabled: row.kind === 'unsorted' }}
          disabled={row.kind === 'unsorted' || !row.text.trim()}
          onPress={() => onChange({ ...row, approved: !row.approved })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, opacity: row.kind === 'unsorted' ? 0.4 : 1 }}
        >
          <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.green, backgroundColor: row.approved ? colors.green : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {row.approved ? <Text style={{ color: '#fff', fontWeight: '700' }}>✓</Text> : null}
          </View>
          <Text style={[type.body, { fontWeight: '600' }]}>{row.kind === 'unsorted' ? 'Välj kategori först' : 'Godkänn'}</Text>
        </Pressable>
        <Pressable onPress={() => onChange({ ...row, text: '' })} hitSlop={8}>
          <Text style={{ color: colors.danger, fontWeight: '600' }}>Hoppa över</Text>
        </Pressable>
      </Row>
    </Card>
  );
}

export function PlanImportScreen() {
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [names, setNames] = useState<{ name: string; add: boolean }[]>([]);
  const [reviewScrub, setReviewScrub] = useState(false);
  const [adapter, setAdapter] = useState<LlmAdapter | null>(null);
  const [busy, setBusy] = useState(false);
  const [notInPlan, setNotInPlan] = useState<Set<string>>(new Set());
  const [usedModel, setUsedModel] = useState<string | null>(null);

  useEffect(() => {
    activeAdapter(repo, { browser: Platform.OS === 'web' }).then(setAdapter);
  }, [repo]);

  const providerLabel = adapter ? PROVIDERS[adapter.provider as keyof typeof PROVIDERS]?.label ?? adapter.provider : '';

  const findNames = () => {
    const known = new Set(repo.settings().scrubNames.map((n) => n.toLowerCase()));
    setNames(namesFromPlanText(text).filter((n) => !known.has(n.toLowerCase())).map((name) => ({ name, add: true })));
  };

  const structure = () => {
    setRows(parsePlanText(text));
    setNotInPlan(new Set());
    setUsedModel(null);
    findNames();
  };

  // Names from the user's list plus the ones they kept ticked in the plan.
  const scrubbed = useMemo(
    () => scrubReversible(text, [...repo.settings().scrubNames, ...names.filter((n) => n.add).map((n) => n.name)]),
    [text, names, repo],
  );

  const startModel = () => {
    findNames();
    setReviewScrub(true);
  };

  const sendToModel = async () => {
    if (!adapter) return;
    setBusy(true);
    try {
      const result = await structurePlanWithModel(trackedCompleter(repo, adapter), scrubbed.text, scrubbed.map, text);
      setRows(result);
      setNotInPlan(new Set(result.filter((r) => !r.inOriginal).map((r) => r.key)));
      setUsedModel(adapter.model);
      setReviewScrub(false);
    } catch (e) {
      await dialog.info(
        'Språkmodellen kunde inte sortera planen',
        `${(e as Error).message} Raderna sorteras på telefonen i stället.`,
      );
      setReviewScrub(false);
      setRows(parsePlanText(text));
      setNotInPlan(new Set());
      setUsedModel(null);
    } finally {
      setBusy(false);
    }
  };

  const visible = rows?.filter((r) => r.text.trim()) ?? [];
  const approved = visible.filter((r) => r.approved && r.kind !== 'unsorted');

  const save = async () => {
    const items = approved.filter((r) => r.kind !== 'normal').map((r) => ({ id: newId('p'), kind: r.kind as PlanItemKind, text: r.text }));
    const normal = approved.filter((r) => r.kind === 'normal').map((r) => r.text.trim());
    await repo.addPlanItems(items);
    if (normal.length) {
      const prev = repo.planSettings().normalState.trim();
      await repo.updatePlanSettings({ normalState: [prev, ...normal].filter(Boolean).join('. ') });
    }
    const addNames = names.filter((n) => n.add).map((n) => n.name);
    if (addNames.length) {
      await repo.updateSettings({ scrubNames: [...repo.settings().scrubNames, ...addNames] });
    }
    await dialog.info('Sparat', `${items.length + normal.length} rader sparades i din krisplan.${addNames.length ? ` ${addNames.length} namn lades till i rensningslistan.` : ''}`);
    nav.replace({ name: 'plan' });
  };

  if (reviewScrub && !rows) {
    return (
      <Screen
        title="Kontrollera rensningen"
        back
        footer={<Button big title={`Skicka till ${providerLabel}`} onPress={sendToModel} busy={busy} />}
      >
        <P muted>
          Så här ser texten ut när den skickas. Markerade ord har bytts ut på telefonen och sätts tillbaka när svaret
          kommer. Står det ett namn kvar? Lägg till det i rensningslistan under Inställningar, eller bocka i det nedan.
        </P>
        {names.length > 0 && (
          <Section title="Namn i planen">
            <Row style={{ gap: 6 }}>
              {names.map((n) => (
                <Chip key={n.name} label={n.name} selected={n.add} color={colors.green}
                  onPress={() => setNames((all) => all.map((x) => (x.name === n.name ? { ...x, add: !x.add } : x)))} />
              ))}
            </Row>
          </Section>
        )}
        <Section title={`${scrubbed.findings.length} saker rensade`}>
          <Card><MarkedText text={scrubbed.text} /></Card>
        </Section>
        <Button kind="ghost" title="‹ Tillbaka till texten" onPress={() => setReviewScrub(false)} />
      </Screen>
    );
  }

  if (!rows) {
    return (
      <Screen
        title="Lägg in krisplan"
        back
        footer={
          adapter ? (
            <>
              <Button big title={`Sortera med ${providerLabel}`} disabled={!text.trim()} onPress={startModel} />
              <Button kind="ghost" title="Sortera på telefonen i stället" disabled={!text.trim()} onPress={structure} />
            </>
          ) : (
            <Button big title="Sortera raderna" disabled={!text.trim()} onPress={structure} />
          )
        }
      >
        <P muted>
          {adapter
            ? `Klistra in din krisplan som text. ${providerLabel} sorterar raderna i tidiga tecken, allvarliga tecken och åtgärder. Texten rensas på telefonen först, och du ser resultatet innan något skickas. Du godkänner varje rad innan den sparas.`
            : 'Klistra in din krisplan som text. Appen sorterar raderna efter rubriker som ”Tidiga tecken”, ”Vid gult” och ”Vid rött”. Du godkänner varje rad innan den sparas. Inget lämnar telefonen.'}
        </P>
        <P muted style={{ marginTop: space.s }}>
          Har du planen på papper? Fotografera den och använd telefonens egen textigenkänning (Live Text på iPhone, Google
          Lens på Android) för att kopiera texten. Fotoimport direkt i appen kräver en utvecklingsbuild.
        </P>
        <Field value={text} onChangeText={setText} multiline placeholder="Klistra in planen här…" style={{ minHeight: 220, marginTop: space.m }} />
        <Button kind="ghost" title="Fyll i ett exempel" onPress={() => setText(EXAMPLE)} />
      </Screen>
    );
  }

  return (
    <Screen
      title="Granska raderna"
      back
      footer={<Button big title={`Spara ${approved.length} godkända rader`} disabled={approved.length === 0} onPress={save} />}
    >
      <P muted>
        Kontrollera kategorin och godkänn varje rad. Rader du inte godkänner sparas inte. Ändrar du texten behöver du godkänna igen.
      </P>
      {usedModel ? (
        <P muted style={{ marginTop: space.s }}>
          Sorterat av {usedModel}. Namn och nummer är tillbakasatta på telefonen.
          {notInPlan.size ? ` ${notInPlan.size} rader står inte ordagrant i din plan och är markerade.` : ''}
        </P>
      ) : null}
      <Button kind="ghost" title="‹ Tillbaka till texten" onPress={() => { setRows(null); setReviewScrub(false); }} />
      {(['early', 'serious', 'action_yellow', 'action_red', 'relatives', 'normal', 'unsorted'] as DraftKind[]).map((k) => {
        const group = visible.filter((r) => r.kind === k);
        if (!group.length) return null;
        return (
          <Section key={k} title={KIND_LABEL[k]}>
            {group.map((r) => (
              <DraftEditor
                key={r.key}
                row={r}
                warning={notInPlan.has(r.key) ? 'Står inte ordagrant i din plan. Kontrollera att raden stämmer.' : undefined}
                onChange={(next) => setRows((all) => all!.map((x) => (x.key === r.key ? next : x)))}
              />
            ))}
          </Section>
        );
      })}

      {names.length > 0 && (
        <Section title="Namn i planen">
          <Card>
            <P muted>
              Namnen tas bort ur text innan den skickas till en språkmodell. Bocka ur ord som inte är namn.
            </P>
            <Row style={{ marginTop: space.s, gap: 6 }}>
              {names.map((n) => (
                <Chip key={n.name} label={n.name} selected={n.add} color={colors.green}
                  onPress={() => setNames((all) => all.map((x) => (x.name === n.name ? { ...x, add: !x.add } : x)))} />
              ))}
            </Row>
          </Card>
        </Section>
      )}
    </Screen>
  );
}
