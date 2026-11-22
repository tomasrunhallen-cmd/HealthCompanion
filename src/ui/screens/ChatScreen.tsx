// Prata (experimental): a conversation with the connected language model, the SORK cards it
// saves, and the description of the conversation, which the person can read and change. The
// emergency rule, scrubbing and the reply check are in code and are shown, not editable.

import React, { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { CODE_PROTECTIONS, chatPrompts, frameForDisplay, roleText, type ChatSession } from '../../core/chat/chat';
import { formatDateSv, formatTime } from '../../core/analysis/dates';
import {
  chatPromptLabel, chatPromptOverride, deleteSession, deleteSork, latestSession, newSession, saveChatPrompt, sendChat, sorkCards,
} from '../../services/chat';
import { llmStatus } from '../../services/llm';
import { CrisisCard } from '../CrisisCard';
import { Button, Card, Disclosure, Field, P, Row, Screen, Tag } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { colors, MIN_TOUCH, radius, space, type } from '../theme';

export function ChatScreen() {
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
  const [ready, setReady] = useState<boolean | null>(null);
  const [session, setSession] = useState<ChatSession | null>(() => latestSession(repo));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void llmStatus(repo).then((s) => live && setReady(s.ready));
    return () => { live = false; };
  }, [repo]);

  const pendingFromChat = repo.pendingSuggestions().filter((s) => s.source === 'chat').length;
  const last = session?.messages[session.messages.length - 1];
  const akutShown = session?.messages.some((m) => m.akut === 'full') ?? false;
  const mildShown = !akutShown && (session?.messages.some((m) => m.akut === 'mild') ?? false);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const t = await sendChat(repo, session?.id ?? null, text);
      setSession(t.session);
      setDraft('');
      if (t.kind === 'no_model') setError('Ingen språkmodell är kopplad. Koppla en under Jag → Språkmodell.');
      if (t.kind === 'failed') setError(`Modellen svarade inte: ${t.message}`);
      if (t.kind === 'reply') {
        const parts = [t.suggestions ? `${t.suggestions === 1 ? 'Ett förslag' : `${t.suggestions} förslag`} att minnas väntar på dig.` : '', t.sork ? 'En SORK-analys sparades.' : ''].filter(Boolean);
        if (parts.length) setNotice(parts.join(' '));
      }
    } finally {
      setBusy(false);
    }
  };

  const fresh = async () => {
    setSession(await newSession(repo));
    setError(null);
    setNotice(null);
  };

  const remove = async () => {
    if (!session) return;
    const ok = await dialog.confirm({ title: 'Radera samtalet?', message: 'Samtalet tas bort från appen. SORK-kort och godkända rader finns kvar.', confirmLabel: 'Radera', danger: true });
    if (!ok) return;
    await deleteSession(repo, session.id);
    setSession(latestSession(repo));
  };

  return (
    <Screen
      title="Prata"
      footer={ready === false ? undefined : (
        <View style={{ gap: space.s }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Skriv här"
            placeholderTextColor={colors.placeholder}
            multiline
            accessibilityLabel="Ditt meddelande"
            style={{ minHeight: MIN_TOUCH, maxHeight: 160, borderWidth: 1, borderColor: colors.border, borderRadius: radius.m, padding: space.m, color: colors.text, backgroundColor: colors.surface, fontSize: 17 }}
          />
          <Button title={busy ? 'Skickar …' : 'Skicka'} onPress={send} busy={busy} disabled={!draft.trim()} />
        </View>
      )}
    >
      <P muted>Experimentellt. Ett samtalsstöd med din plan som grund, inte vård. Vid akut fara: ring 112.</P>
      <Row style={{ gap: space.s, flexWrap: 'wrap', marginTop: space.s }}>
        <Button kind="secondary" title="Nytt samtal" onPress={fresh} />
        <Button kind="secondary" title="SORK-kort" onPress={() => nav.push({ name: 'sork' })} />
        <Button kind="secondary" title="Prompten" onPress={() => nav.push({ name: 'chatPrompt' })} hint="Visar och ändrar hur samtalet går till" />
      </Row>

      {ready === false ? (
        <Card style={{ marginTop: space.l }}>
          <P>Prata använder språkmodellen du kopplat till appen. Ingen är kopplad än.</P>
          <Button title="Koppla en språkmodell" onPress={() => nav.push({ name: 'llm' })} style={{ marginTop: space.m }} />
        </Card>
      ) : null}

      {akutShown ? <View style={{ marginTop: space.l }}><CrisisCard plan={repo.plan()} /></View> : null}
      {mildShown ? <View style={{ marginTop: space.l }}><CrisisCard plan={repo.plan()} mild /></View> : null}

      <View style={{ marginTop: space.l, gap: space.s }}>
        {!session?.messages.length ? (
          <P muted>Skriv vad du vill prata om. Vill du gå igenom en händelse kan du be om en SORK-analys.</P>
        ) : session.messages.map((m, i) => {
          const mine = m.role === 'user';
          const who = mine ? 'Du' : 'Prata';
          const note = m.akut === 'full' ? ' Skickades inte: Hjälp nu visas i stället.' : m.replaced ? ' Modellens svar bröt mot reglerna och ersattes av appens text.' : '';
          return (
            <View
              key={m.at + i}
              accessible
              accessibilityLabel={`${who}, ${formatTime(m.at)}: ${m.text}.${note}`}
              style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', backgroundColor: mine ? colors.accentSoft : colors.surface, borderRadius: radius.l, padding: space.m }}
            >
              <Text style={type.body}>{m.text}</Text>
              <Text style={[type.small, { marginTop: space.xs }]}>{`${who} · ${formatTime(m.at)}${note}`}</Text>
            </View>
          );
        })}
        {busy && last?.role === 'user' ? <P muted>Skriver …</P> : null}
      </View>

      {error ? <Card tone="yellow" style={{ marginTop: space.l }}><P>{error}</P></Card> : null}
      {notice || pendingFromChat ? (
        <Card style={{ marginTop: space.l }}>
          <P>{notice ?? `${pendingFromChat === 1 ? 'Ett förslag' : `${pendingFromChat} förslag`} från samtalen väntar på dig.`}</P>
          {pendingFromChat ? <Button kind="secondary" title="Granska förslagen" onPress={() => nav.push({ name: 'suggestions' })} style={{ marginTop: space.s }} /> : null}
        </Card>
      ) : null}

      {session?.messages.length ? (
        <Button kind="ghost" title="Radera samtalet" onPress={remove} style={{ marginTop: space.l }} />
      ) : null}
    </Screen>
  );
}

export function SorkScreen() {
  const repo = useRepo();
  const dialog = useDialog();
  const cards = sorkCards(repo);
  return (
    <Screen title="SORK-kort">
      <P muted>Analyser du gått igenom i Prata och bekräftat. Situation, Organism (sömn, stress och mående just då), Reaktion och Konsekvens.</P>
      {!cards.length ? <P style={{ marginTop: space.l }}>Inga SORK-kort än. Be om en SORK-analys i Prata när du vill förstå en händelse.</P> : null}
      {cards.map((c) => (
        <Card key={c.id} style={{ marginTop: space.l }}>
          <Text style={type.label}>{formatDateSv(c.createdAt.slice(0, 10)).toUpperCase()}</Text>
          {([['Situation', c.situation], ['Organism', c.organism], ['Reaktion', c.reaktion], ['Konsekvens', c.konsekvens]] as const).map(([k, v]) => (v ? (
            <View key={k} style={{ marginTop: space.s }}>
              <Text style={[type.body, { fontWeight: '600' }]}>{k}</Text>
              <P>{v}</P>
            </View>
          ) : null))}
          <Button
            kind="ghost"
            title="Ta bort"
            label={`Ta bort SORK-kortet från ${formatDateSv(c.createdAt.slice(0, 10))}`}
            onPress={async () => {
              if (await dialog.confirm({ title: 'Ta bort SORK-kortet?', message: 'Kortet tas bort från appen.', confirmLabel: 'Ta bort', danger: true })) await deleteSork(repo, c.id);
            }}
            style={{ marginTop: space.s }}
          />
        </Card>
      ))}
    </Screen>
  );
}

export function ChatPromptScreen() {
  const repo = useRepo();
  const dialog = useDialog();
  const override = chatPromptOverride(repo);
  const [text, setText] = useState(() => roleText(override));
  const [saved, setSaved] = useState(false);
  const standard = chatPrompts().standard.system.trim();
  const changed = text.trim() !== roleText(override);

  return (
    <Screen title="Prompten">
      <P muted>Så här får modellen veta hur samtalet ska gå till. Din text kan du ändra. Ramen runt den och skydden i koden kan inte ändras.</P>
      <Row style={{ gap: space.s, marginTop: space.s }}>
        <Tag label={override?.text.trim() ? 'Egen text' : 'Standard'} />
      </Row>
      <P muted style={{ marginTop: space.xs }}>{`Version: ${chatPromptLabel(repo)}`}</P>

      <Field
        label="Din text"
        value={text}
        onChangeText={(t) => { setText(t); setSaved(false); }}
        multiline
        style={{ minHeight: 280, marginTop: space.m }}
        accessibilityLabel="Din text om hur samtalet ska gå till"
      />
      <Button title="Spara" onPress={async () => { await saveChatPrompt(repo, text); setSaved(true); }} disabled={!changed} />
      {saved ? <P muted style={{ marginTop: space.s }}>Sparat. Gäller från nästa meddelande.</P> : null}
      <Button
        kind="ghost"
        title="Återställ standard"
        disabled={text.trim() === standard && !override?.text.trim()}
        onPress={async () => {
          if (!(await dialog.confirm({ title: 'Återställ standard?', message: 'Din text ersätts av standardtexten. Den gamla sparas i historiken.', confirmLabel: 'Återställ' }))) return;
          await saveChatPrompt(repo, standard);
          setText(standard);
          setSaved(true);
        }}
        style={{ marginTop: space.s }}
      />

      <Disclosure title="Ramen, som inte kan ändras">
        <Text selectable style={[type.small, { fontFamily: 'Courier' }]}>{frameForDisplay()}</Text>
      </Disclosure>
      <Disclosure title="Skydd i koden">
        {CODE_PROTECTIONS.map((p) => <P key={p} style={{ marginTop: space.xs }}>{`• ${p}`}</P>)}
      </Disclosure>
      {override?.history.length ? (
        <Disclosure title={`Tidigare versioner (${override.history.length})`}>
          {override.history.map((h) => (
            <View key={h.savedAt} style={{ marginTop: space.s }}>
              <Text style={type.label}>{formatDateSv(h.savedAt.slice(0, 10)).toUpperCase()}</Text>
              <P muted>{h.text.length > 300 ? `${h.text.slice(0, 299)}…` : h.text}</P>
              <Button kind="ghost" title="Använd den här" label={`Använd versionen från ${formatDateSv(h.savedAt.slice(0, 10))}`} onPress={() => { setText(h.text); setSaved(false); }} />
            </View>
          ))}
        </Disclosure>
      ) : null}
    </Screen>
  );
}
