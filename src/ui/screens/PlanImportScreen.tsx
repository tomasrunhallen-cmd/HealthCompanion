// Lägg in plan: a crisis plan as pasted text, PDF or .docx, sorted by its own headings in
// code, with a language model only for headings the rules table does not know. The person
// reviews every row under the plan's own headings, in the plan's order, and approves it
// before anything is saved. The draft is saved after every change.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { PROVIDERS } from '../../adapter/providers';
import type { LlmAdapter } from '../../adapter/types';
import { replaceStandard, unconfirmedStandard } from '../../context/standard';
import type { PlanFields, RowKind } from '../../domain/types';
import { sortVariables, type DraftPlanRow } from '../../plan/classify';
import {
  NEUTRAL_POLARITY, OBSERVER_TEXT, ROW_KIND_TEXT, ROW_KINDS, SEVERITY_TEXT, WHEN_TEXT, WHO_TEXT, normalizeFields, polarityText,
} from '../../plan/fields';
import {
  DRAFT_KEY, approveHeading, countBySource, draftFromPages, draftFromText, pendingForModel, reviewSections, sleepWindowIn, sortDraftWithModel,
  updateRow, windowHours, type HeadingCount, type PlanDraft,
} from '../../plan/importPlan';
import { saveApprovedRows } from '../../plan/savePlan';
import { linesFromDocx, linesFromPdf } from '../../plan/source';
import { pickBinaryFile } from '../../platform/files';
import { namesFromPlanText } from '../../privacy/scrub';
import { activeAdapter, trackedCompleter } from '../../services/llm';
import { Button, Card, Chip, Field, P, Row, Screen, Section, Segmented } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { colors, MIN_TOUCH, space, type } from '../theme';

const EXAMPLE = `Tidiga varningstecken
- Sover mindre än sex timmar
- Svarar inte på sms

Tecken som brukar tyda på allvarlig försämring
- Slutar äta
- Känner att andra är emot mig

Överenskomna åtgärder vid tidiga varningstecken
- Går och lägger mig före 23
- Ringer Kim

Överenskomna åtgärder vid allvarlig försämring
- Ringer mottagningen

Livsstil och rutiner
- Sömn 23:00–07:00 alla dagar

Normalläge: sover sju timmar, jobbar dagtid`;

const FILE_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pdf', '.docx'];

function countText(c: HeadingCount): string {
  const parts = [`${c.total} ${c.total === 1 ? 'rad' : 'rader'}`, `${c.rules} enligt rubriken`];
  if (c.model) parts.push(`${c.model} av modellen`);
  if (c.needs) parts.push(`${c.needs} behöver din sortering`);
  parts.push(`${c.approved} godkända`);
  return parts.join(' · ');
}

/** What the row's fields say, for the confirmation after a change. */
function fieldsSummary(f: PlanFields, words: PlanDraft['polarityWords']): string {
  const parts = [ROW_KIND_TEXT[f.kind]];
  if (f.kind === 'sign') parts.push(SEVERITY_TEXT[f.severity ?? 'early'], OBSERVER_TEXT[f.observer ?? 'self']);
  if (f.kind === 'action') parts.push(WHEN_TEXT[f.when ?? 'always'], WHO_TEXT[f.who ?? 'me']);
  if (f.polarity !== 'both' && f.kind !== 'ignore') parts.push(polarityText(f.polarity, { polarityWords: words }));
  return parts.join(', ');
}

const HAS_POLARITY: RowKind[] = ['sign', 'trigger', 'action', 'routine'];

function RowEditor(props: {
  row: DraftPlanRow;
  words: PlanDraft['polarityWords'];
  showHeading?: boolean;
  confirmation: string | null;
  onChange: (patch: Partial<DraftPlanRow>, changed?: boolean) => void;
}) {
  const { row, words, onChange } = props;
  const f = row.fields;
  const setFields = (patch: Partial<PlanFields>) => onChange({ fields: normalizeFields({ ...f, ...patch }), approved: false, touched: true }, true);
  const up = words.up ?? NEUTRAL_POLARITY.up;
  const down = words.down ?? NEUTRAL_POLARITY.down;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const status = row.source === 'needs' && !row.touched
    ? 'Behöver din sortering'
    : row.touched ? 'Du har ändrat raden' : row.source === 'model' ? 'Sorterad av språkmodellen' : 'Sorterad enligt rubriken';

  return (
    <Card style={{ borderColor: row.approved ? colors.green : colors.border, borderWidth: row.approved ? 2 : 1, marginLeft: row.parentId ? space.l : 0 }}>
      {props.showHeading && row.heading ? <Text style={[type.small, { marginBottom: space.xs }]}>Under {row.heading}</Text> : null}
      {/* The confirmation takes the status line's place, so nothing under the finger moves. */}
      <Text
        accessibilityLiveRegion="polite"
        numberOfLines={1}
        style={[type.label, { marginBottom: space.xs, color: props.confirmation ? colors.green : row.source === 'needs' && !row.touched ? colors.danger : colors.textMuted }]}
      >
        {props.confirmation ? `Ändrat: ${props.confirmation}. Ligger kvar här` : status}
      </Text>
      {row.akut ? (
        <Text style={[type.small, { color: colors.danger, marginBottom: space.xs }]}>
          Raden handlar om att inte vilja leva. Den sparas som din egen akuta formulering, skickas aldrig till en språkmodell och ger krisrutan när du skriver den.
        </Text>
      ) : null}
      <TextInput
        value={row.text}
        onChangeText={(text) => onChange({ text, approved: false, touched: true })}
        multiline
        accessibilityLabel="Radens text"
        style={{ fontSize: 17, color: colors.text, padding: 0, marginBottom: space.s, minHeight: MIN_TOUCH }}
      />
      {row.special === 'normal' ? (
        <P muted>Normalläge. Sparas som din beskrivning av hur du är när du mår som vanligt.</P>
      ) : row.akut ? null : (
        <>
          <Text style={[type.label, { marginTop: space.xs }]}>Vad är raden?</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Vad är raden?" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.xs }}>
            {ROW_KINDS.map((k) => (
              <Chip key={k} label={ROW_KIND_TEXT[k]} selected={f.kind === k} onPress={() => setFields({ kind: k })} />
            ))}
          </View>
          {HAS_POLARITY.includes(f.kind) ? (
            <Segmented label="Gäller" value={f.polarity} onChange={(polarity) => setFields({ polarity })}
              options={[{ value: 'up', label: cap(up) }, { value: 'down', label: cap(down) }, { value: 'both', label: 'Båda' }]} />
          ) : null}
          {f.kind === 'sign' ? (
            <>
              <Segmented label="Hur allvarligt" value={f.severity} onChange={(severity) => setFields({ severity })}
                options={[{ value: 'early', label: SEVERITY_TEXT.early }, { value: 'serious', label: SEVERITY_TEXT.serious }]} />
              <Segmented label="Vem märker det" value={f.observer} onChange={(observer) => setFields({ observer })}
                options={[{ value: 'self', label: OBSERVER_TEXT.self }, { value: 'others', label: OBSERVER_TEXT.others }]} />
            </>
          ) : null}
          {f.kind === 'action' ? (
            <>
              <Segmented label="När" value={f.when} onChange={(when) => setFields({ when })}
                options={[{ value: 'early', label: 'Tidiga tecken' }, { value: 'serious', label: 'Allvarligt' }, { value: 'always', label: WHEN_TEXT.always }]} />
              <Segmented label="Vem gör det" value={f.who} onChange={(who) => setFields({ who })}
                options={[{ value: 'me', label: WHO_TEXT.me }, { value: 'relative', label: WHO_TEXT.relative }, { value: 'care', label: WHO_TEXT.care }]} />
              {f.order ? <P muted style={{ marginTop: space.s }}>Steg {f.order} i planens trappa.</P> : null}
            </>
          ) : null}
        </>
      )}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Godkänn raden"
        accessibilityState={{ checked: row.approved, disabled: !row.text.trim() }}
        disabled={!row.text.trim()}
        onPress={() => onChange({ approved: !row.approved })}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.m, minHeight: MIN_TOUCH }}
      >
        <View style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: colors.green, backgroundColor: row.approved ? colors.green : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          {row.approved ? <Text style={{ color: colors.onAccent, fontWeight: '700' }}>✓</Text> : null}
        </View>
        <Text style={[type.body, { fontWeight: '600' }]}>{f.kind === 'ignore' ? 'Godkänn att raden inte sparas' : 'Godkänn'}</Text>
      </Pressable>
    </Card>
  );
}

function HeadingSection(props: {
  heading: string;
  count: HeadingCount;
  collapsed: boolean;
  onToggle: () => void;
  onApproveAll: () => void;
  children: React.ReactNode;
}) {
  const title = props.heading || 'Utan rubrik';
  const allApproved = props.count.approved === props.count.total;
  return (
    <View style={{ marginTop: space.xl }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${countText(props.count)}`}
        accessibilityState={{ expanded: !props.collapsed }}
        accessibilityHint={props.collapsed ? 'Visar raderna' : 'Döljer raderna'}
        onPress={props.onToggle}
        style={{ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.s }}
      >
        <Text style={[type.h2, { flex: 1 }]} accessibilityRole="header">{title}</Text>
        <Text style={{ fontSize: 17, color: colors.accent }}>{props.collapsed ? '›' : '⌄'}</Text>
      </Pressable>
      <Text style={[type.small, { marginBottom: space.s }]}>{countText(props.count)}</Text>
      {!props.collapsed ? (
        <>
          <Button kind="secondary" title={allApproved ? 'Alla under rubriken är godkända' : 'Godkänn alla under den här rubriken'}
            disabled={allApproved} onPress={props.onApproveAll} style={{ marginBottom: space.m }} />
          {props.children}
        </>
      ) : null}
    </View>
  );
}

export function PlanImportScreen() {
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
  const [text, setText] = useState('');
  const [draft, setDraftState] = useState<PlanDraft | null>(null);
  const [saved, setSaved] = useState<PlanDraft | null>(() => (repo.kvGet(DRAFT_KEY) as PlanDraft | null) ?? null);
  const [step, setStep] = useState<'input' | 'send' | 'review'>('input');
  const [names, setNames] = useState<{ name: string; add: boolean }[]>([]);
  const [adapter, setAdapter] = useState<LlmAdapter | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activeAdapter(repo, { browser: Platform.OS === 'web', purpose: 'import' }).then(setAdapter);
  }, [repo]);

  // Autosave: the draft is written shortly after every change, so a long plan can be reviewed over several sessions.
  const setDraft = (next: PlanDraft | ((d: PlanDraft) => PlanDraft)) => {
    setDraftState((prev) => {
      const value = typeof next === 'function' ? (prev ? next(prev) : prev) : next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void repo.kvSet(DRAFT_KEY, value), 400);
      return value;
    });
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const providerLabel = adapter ? PROVIDERS[adapter.provider as keyof typeof PROVIDERS]?.label ?? adapter.provider : '';
  const scrubNames = useMemo(() => [...repo.settings().scrubNames, ...names.filter((n) => n.add).map((n) => n.name)], [repo, names]);

  const begin = (d: PlanDraft) => {
    setDraft(d);
    const unknownText = d.unknown.flatMap((g) => [g.heading, ...g.ids.map((id) => d.rows.find((r) => r.id === id)?.text ?? '')]).join('. ');
    const known = new Set(repo.settings().scrubNames.map((n) => n.toLowerCase()));
    setNames(namesFromPlanText(unknownText).filter((n) => !known.has(n.toLowerCase())).map((name) => ({ name, add: true })));
    setStep(adapter && pendingForModel(d) > 0 ? 'send' : 'review');
  };

  const fromText = () => begin(draftFromText(text));

  const fromFile = async () => {
    const file = await pickBinaryFile(FILE_TYPES);
    if (!file) return;
    setBusy('Läser filen…');
    try {
      const head = String.fromCharCode(...file.data.slice(0, 4));
      if (head.startsWith('%PDF')) {
        const pages = await linesFromPdf(file.data);
        if (!pages.some((p) => p.length)) throw new Error('PDF:en har ingen text. Är den inskannad? Använd telefonens textigenkänning och klistra in texten i stället.');
        begin(draftFromPages(pages, 'pdf', { sourceName: file.name }));
      } else if (head.startsWith('PK')) {
        const doc = linesFromDocx(file.data);
        begin(draftFromPages(doc.pages, 'docx', { furniture: doc.furniture, sourceName: file.name }));
      } else {
        throw new Error('Välj en PDF eller en Word-fil (.docx).');
      }
    } catch (e) {
      await dialog.info('Filen gick inte att läsa', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const sendToModel = async () => {
    if (!adapter || !draft) return;
    setBusy('Sorterar…');
    try {
      const res = await sortDraftWithModel(draft, trackedCompleter(repo, adapter), adapter.model, scrubNames, (done, total) =>
        setBusy(`Sorterar rubrik ${Math.min(done + 1, total)} av ${total}…`),
      );
      setDraft(res.draft);
      if (res.failed) {
        await dialog.info(
          'Några rader behöver din sortering',
          `Modellens svar höll inte för ${res.failed === 1 ? 'en rubrik' : `${res.failed} rubriker`}, inte heller andra gången. Raderna ligger först i granskningen och är markerade.`,
        );
      }
    } finally {
      setBusy(null);
      setStep('review');
    }
  };

  const change = (id: string, patch: Partial<DraftPlanRow>, changed = false) => {
    setDraft((d) => {
      const next = updateRow(d, id, patch);
      if (changed) {
        const row = next.rows.find((r) => r.id === id)!;
        setConfirm({ id, text: ROW_KIND_TEXT[row.fields.kind] });
        AccessibilityInfo.announceForAccessibility?.(`Ändrat till ${fieldsSummary(row.fields, next.polarityWords)}. Raden ligger kvar på samma plats.`);
      }
      return next;
    });
  };

  const save = async () => {
    if (!draft) return;
    const sleep = sleepWindowIn(draft.rows.filter((r) => r.approved));
    const sum = await saveApprovedRows(repo, draft);
    let removed = 0;
    if (unconfirmedStandard(repo).length > 0) {
      const replace = await dialog.confirm({
        title: 'Ta bort standardraderna?',
        message: 'Din egen plan ersätter standardinnehållet. Standardrader du redan bekräftat ligger kvar.',
        confirmLabel: 'Ta bort standardraderna',
      });
      if (replace) removed = await replaceStandard(repo);
    } else if (repo.settings().contextMode !== 'own') {
      await repo.updateSettings({ contextMode: 'own' });
    }
    const addNames = names.filter((n) => n.add).map((n) => n.name);
    if (addNames.length) await repo.updateSettings({ scrubNames: [...repo.settings().scrubNames, ...addNames] });
    if (sleep) {
      const limit = Math.max(4, Math.round((windowHours(sleep.start, sleep.end) - 2) * 2) / 2);
      const now = repo.planSettings().sleepThresholdHours;
      const use = await dialog.confirm({
        title: `Använda sömnfönstret ${sleep.start}–${sleep.end}?`,
        message:
          `Planen säger ”${sleep.text}”. Appen kan räkna sömn under ${String(limit).replace('.', ',')} timmar som ett tidigt tecken, ` +
          `i stället för ${String(now).replace('.', ',')} timmar i dag. Gränsen är fönstret minus två timmar. Det är appens tolkning, ` +
          'inte planens, och du kan ändra den under Min krisplan.',
        confirmLabel: 'Använd sömnfönstret',
      });
      if (use) await repo.updatePlanSettings({ sleepWindow: { start: sleep.start, end: sleep.end }, sleepThresholdHours: limit });
    }
    const extra = [
      sum.akut ? `${sum.akut} som akut formulering` : '',
      sum.normal ? `${sum.normal} som normalläge` : '',
      removed ? `${removed} standardrader togs bort` : '',
      addNames.length ? `${addNames.length} namn lades till i rensningslistan` : '',
    ].filter(Boolean);
    await dialog.info('Sparat', `${sum.saved + sum.akut + sum.normal} rader sparades i din krisplan.${extra.length ? ` ${extra.join('. ')}.` : ''}`);
    setDraftState(null);
    setSaved(null);
    nav.replace({ name: 'plan' });
  };

  const discard = async () => {
    const ok = await dialog.confirm({
      title: 'Börja om?',
      message: 'Utkastet och dina val i granskningen tas bort. Inget i din krisplan ändras.',
      confirmLabel: 'Ta bort utkastet',
    });
    if (!ok) return;
    if (timer.current) clearTimeout(timer.current);
    await repo.kvSet(DRAFT_KEY, null);
    setDraftState(null);
    setSaved(null);
    setStep('input');
  };

  // ---- what is sent ----
  if (step === 'send' && draft) {
    const needs = new Set(draft.rows.filter((r) => r.source === 'needs').map((r) => r.id));
    const groups = draft.unknown.filter((g) => g.ids.some((id) => needs.has(id)));
    const known = draft.rows.length - draft.rows.filter((r) => r.source === 'needs').length;
    return (
      <Screen
        title="Det här skickas"
        footer={
          <>
            <Button big title={`Skicka till ${providerLabel}`} onPress={sendToModel} busy={!!busy} />
            <Button kind="ghost" title="Sortera själv i stället" onPress={() => setStep('review')} disabled={!!busy} />
          </>
        }
      >
        {busy ? <Text accessibilityLiveRegion="polite" style={type.body}>{busy}</Text> : null}
        <P muted>
          {known} av {draft.rows.length} rader sorterades på telefonen enligt planens rubriker. Raderna under{' '}
          {groups.length === 1 ? 'en rubrik' : `${groups.length} rubriker`} känner appen inte igen. De skickas till {adapter?.model},
          en rubrik i taget, rensade på telefonen. Modellen svarar bara med vad varje rad är och skriver aldrig om texten.
          Önskemål, rader till vården, kontakter och akuta formuleringar skickas aldrig.
        </P>
        {names.length > 0 && (
          <Section title="Namn i texten">
            <P muted>Ikryssade namn byts ut innan något skickas.</P>
            <Row style={{ gap: 6, marginTop: space.s }}>
              {names.map((n) => (
                <Chip key={n.name} label={n.name} selected={n.add} color={colors.green}
                  onPress={() => setNames((all) => all.map((x) => (x.name === n.name ? { ...x, add: !x.add } : x)))} />
              ))}
            </Row>
          </Section>
        )}
        {groups.map((g) => {
          const v = sortVariables({ heading: g.heading, rows: g.ids.filter((id) => needs.has(id)).map((id) => ({ id, text: draft.rows.find((r) => r.id === id)!.text })) }, scrubNames);
          return (
            <Section key={g.heading || '-'} title={v.rubrik}>
              <Card>
                {v.rader.split('\n').map((l) => <P key={l}>{(JSON.parse(l) as { text: string }).text}</P>)}
              </Card>
            </Section>
          );
        })}
        <Button kind="ghost" title="‹ Tillbaka" onPress={() => { setDraftState(null); setStep('input'); }} />
      </Screen>
    );
  }

  // ---- review ----
  if (step === 'review' && draft) {
    const { needs, sections } = reviewSections(draft);
    const approved = draft.rows.filter((r) => r.approved && r.text.trim() && r.fields.kind !== 'ignore').length;
    const total = countBySource(draft.rows);
    const collapsed = new Set(draft.collapsed);
    const toggle = (h: string) => setDraft((d) => ({ ...d, collapsed: collapsed.has(h) ? d.collapsed.filter((x) => x !== h) : [...d.collapsed, h] }));
    const editor = (r: DraftPlanRow, showHeading = false) => (
      <RowEditor key={r.id} row={r} words={draft.polarityWords} showHeading={showHeading}
        confirmation={confirm?.id === r.id ? confirm.text : null}
        onChange={(patch, changed) => change(r.id, patch, changed)} />
    );
    return (
      <Screen
        title="Granska raderna"
        footer={<Button big title={`Spara ${approved} godkända rader`} disabled={approved === 0} onPress={save} />}
      >
        <P muted>
          Raderna står i planens ordning under planens egna rubriker. Byter du vad en rad är ligger den kvar på samma plats.
          Rader du inte godkänner sparas inte. Utkastet sparas medan du granskar, så du kan fortsätta en annan gång.
        </P>
        <P muted style={{ marginTop: space.s }}>
          {total.rules} rader sorterades enligt rubrikerna{total.model ? `, ${total.model} av ${draft.model}` : ''}
          {total.needs ? `, ${total.needs} behöver din sortering` : ''}. {total.approved} av {total.total} är godkända.
        </P>
        {adapter && pendingForModel(draft) > 0 ? (
          <Button kind="secondary" title={`Låt ${providerLabel} sortera rubrikerna som appen inte känner igen`} onPress={() => setStep('send')} />
        ) : null}

        {draft.removed.length ? (
          <Section title="Borttaget sidhuvud">
            <Card>
              <P muted>Rader som upprepas på varje sida, som namn, personnummer och sidnummer. De sparas inte och skickas aldrig.</P>
              {draft.removed.map((r) => <Text key={r} style={[type.small, { marginTop: space.xs, textDecorationLine: 'line-through' }]}>{r}</Text>)}
            </Card>
          </Section>
        ) : null}

        {needs.length ? (
          <Section title="Behöver din sortering">
            <P muted style={{ marginBottom: space.s }}>
              Appen kände inte igen rubriken{adapter ? ', och modellen har inte sorterat raderna' : ''}. De står som tidiga tecken tills du väljer.
            </P>
            {needs.map((r) => editor(r, true))}
          </Section>
        ) : null}

        {sections.map((s) => {
          const rows = s.rows.filter((r) => r.source !== 'needs');
          if (!rows.length) return null;
          return (
            <HeadingSection key={s.heading || '-'} heading={s.heading} count={s.count}
              collapsed={collapsed.has(s.heading)} onToggle={() => toggle(s.heading)}
              onApproveAll={() => setDraft((d) => approveHeading(d, s.heading))}>
              {rows.map((r) => editor(r))}
            </HeadingSection>
          );
        })}

        <View style={{ marginTop: space.xl }}>
          <Button kind="ghost" title="Börja om med en annan plan" onPress={discard} />
        </View>
      </Screen>
    );
  }

  // ---- input ----
  return (
    <Screen
      title="Lägg in plan"
      footer={
        <>
          <Button big title="Sortera raderna" disabled={!text.trim() || !!busy} onPress={fromText} />
          <Button kind="secondary" title="Välj PDF eller Word-fil" onPress={fromFile} busy={busy === 'Läser filen…'} />
        </>
      }
    >
      {saved ? (
        <Card tone="accent">
          <P>
            Du har en plan som inte är färdiggranskad{saved.sourceName ? ` (${saved.sourceName})` : ''}:{' '}
            {saved.rows.filter((r) => r.approved).length} av {saved.rows.length} rader godkända.
          </P>
          <Button title="Fortsätt granska" onPress={() => { setDraftState(saved); setStep('review'); }} />
          <Button kind="ghost" title="Ta bort utkastet" onPress={discard} />
        </Card>
      ) : null}
      <P muted>
        Klistra in din krisplan som text, eller välj planen som PDF eller Word-fil. Appen läser filen på telefonen, tar bort
        sidhuvuden med namn och personnummer och sorterar raderna efter planens egna rubriker.
        {adapter
          ? ` Rader under rubriker som appen inte känner igen kan sorteras av ${providerLabel}. Du ser exakt vad som skickas innan något skickas.`
          : ' Inget lämnar telefonen.'}{' '}
        Du godkänner varje rad innan den sparas.
      </P>
      <P muted style={{ marginTop: space.s }}>
        Har du planen på papper? Fotografera den och använd telefonens egen textigenkänning (Live Text på iPhone, Google
        Lens på Android) för att kopiera texten.
      </P>
      <Field value={text} onChangeText={setText} multiline placeholder="Klistra in planen här…" accessibilityLabel="Planens text" style={{ minHeight: 220, marginTop: space.m }} />
      <Button kind="ghost" title="Fyll i ett exempel" onPress={() => setText(EXAMPLE)} />
    </Screen>
  );
}

