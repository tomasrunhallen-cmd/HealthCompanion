// Prata (experimental): a conversation with the connected language model, the SORK cards it
// saves, and the description of the conversation, which the person can read and change. The
// emergency rule, scrubbing and the reply check are in code and are shown, not editable.

import React, { useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { Pressable, ScrollView, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { CHAT_MESSAGE_MAX, CHAT_OPENERS, CODE_PROTECTIONS, chatPrompts, frameForDisplay, roleText, sessionTitle, SORK_LABELS, SORK_STARTER } from '../../core/chat/chat';
import { formatDateSv, formatTime } from '../../core/analysis/dates';
import {
  approveSork, chatPromptLabel, chatPromptOverride, chatSessions, currentSession, deleteSession, deleteSork, newSession, openSession, saveChatPrompt, sendChat, sorkCards,
} from '../../services/chat';
import { llmStatus } from '../../services/llm';
import { CrisisCard } from '../CrisisCard';
import { Button, Card, Chip, Disclosure, Field, P, Row, Screen, Tag } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { colors, MIN_TOUCH, radius, space, type } from '../theme';

/** The bubble while the model writes: moving dots, and after a while how long it has taken. */
function Waiting() {
  // Ticks of 450 ms since the message went: no clock is read while rendering.
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTicks((n) => n + 1), 450);
    return () => clearInterval(t);
  }, []);
  const secs = Math.floor((ticks * 450) / 1000);
  const dots = '•'.repeat(1 + (ticks % 3));
  const slow = secs >= 8;
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={slow ? `Väntar på svar, ${secs} sekunder` : 'Prata skriver'}
      style={{ alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: colors.surface, borderRadius: radius.l, padding: space.m }}
    >
      <Text style={[type.h2, { color: colors.accent, letterSpacing: 2 }]}>{dots}</Text>
      <Text style={type.small}>{slow ? `Väntar på svar · ${secs} s. Svar tar ofta 5–20 sekunder.` : 'Prata skriver …'}</Text>
    </View>
  );
}

function Bubble({ who, text, at, note, mine }: { who: string; text: string; at: string; note?: string; mine: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel={`${who}, ${formatTime(at)}: ${text}.${note ?? ''}`}
      style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', backgroundColor: mine ? colors.accentSoft : colors.surface, borderRadius: radius.l, padding: space.m }}
    >
      <Text style={type.body}>{text}</Text>
      <Text style={[type.small, { marginTop: space.xs }]}>{`${who} · ${formatTime(at)}${note ?? ''}`}</Text>
    </View>
  );
}

export function ChatScreen() {
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
  const scroll = useRef<ScrollViewInstance>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  // The message on its way: shown at once, before the model answers.
  const [pending, setPending] = useState<{ text: string; at: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sorkHelp, setSorkHelp] = useState(false);
  // Follows what is stored, so a conversation opened from the list shows at once.
  const session = currentSession(repo);
  const busy = !!pending;
  const focused = useIsFocused();
  const sessionId = session?.id ?? null;
  const hasMessages = !!session?.messages.length;

  // Opening Prata, coming back to the tab, or choosing a conversation in the list lands at the
  // newest message at once, without an animation through the whole conversation. Content size
  // does not change on a return to the tab, so this does not rely on onContentSizeChange.
  useEffect(() => {
    if (!focused || !hasMessages) return;
    const id = setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 0);
    return () => clearTimeout(id);
  }, [focused, sessionId, hasMessages]);

  useEffect(() => {
    let live = true;
    void llmStatus(repo).then((s) => live && setReady(s.ready));
    return () => { live = false; };
  }, [repo]);

  const pendingFromChat = repo.pendingSuggestions().filter((s) => s.source === 'chat').length;
  const drafts = session ? sorkCards(repo).filter((c) => c.sessionId === session.id && !c.approvedAt) : [];
  const akutShown = session?.messages.some((m) => m.akut === 'full') ?? false;
  const mildShown = !akutShown && (session?.messages.some((m) => m.akut === 'mild') ?? false);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setError(null);
    setNotice(null);
    setPending({ text, at: new Date().toISOString() });
    setDraft('');
    try {
      const t = await sendChat(repo, session?.id ?? null, text);
      if (t.kind === 'too_long') {
        // Nothing was sent: the text goes back in the field to be shortened.
        setDraft(text);
        setError(`Meddelandet är ${t.length} tecken. Korta det till högst ${t.max} och skicka igen; inget har skickats.`);
        return;
      }
      if (t.kind === 'no_model') setError('Ingen språkmodell är kopplad. Koppla en under Jag → Inställningar → AI-stöd.');
      if (t.kind === 'failed') setError(`Modellen svarade inte: ${t.message} Ditt meddelande är sparat; skriv igen när du vill.`);
      if (t.kind === 'reply') {
        const parts = [t.suggestions ? `${t.suggestions === 1 ? 'Ett förslag' : `${t.suggestions} förslag`} att minnas väntar på dig.` : ''].filter(Boolean);
        if (parts.length) setNotice(parts.join(' '));
      }
    } finally {
      setPending(null);
    }
  };

  const fresh = async () => {
    await newSession(repo);
    setError(null);
    setNotice(null);
    setSorkHelp(false);
  };

  const remove = async () => {
    if (!session) return;
    const ok = await dialog.confirm({ title: 'Radera samtalet?', message: 'Samtalet tas bort från appen. SORK-kort och godkända rader finns kvar.', confirmLabel: 'Radera', danger: true });
    if (!ok) return;
    await deleteSession(repo, session.id);
  };

  const messages = session?.messages ?? [];
  const empty = !messages.length && !pending;
  const count = chatSessions(repo).length;

  return (
    <Screen
      title="Prata"
      scroll={false}
      footer={ready === false ? undefined : (
        <View style={{ gap: space.s }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={busy ? 'Väntar på svar …' : 'Skriv här'}
            placeholderTextColor={colors.placeholder}
            multiline
            editable={!busy}
            accessibilityLabel="Ditt meddelande"
            style={{ minHeight: MIN_TOUCH, maxHeight: 160, borderWidth: 1, borderColor: colors.border, borderRadius: radius.m, padding: space.m, color: colors.text, backgroundColor: colors.surface, fontSize: 17 }}
          />
          {draft.length > CHAT_MESSAGE_MAX * 0.8 ? (
            <Text style={[type.small, { color: draft.length > CHAT_MESSAGE_MAX ? colors.danger : colors.textMuted }]} accessibilityLiveRegion="polite">{`${draft.length} av högst ${CHAT_MESSAGE_MAX} tecken`}</Text>
          ) : null}
          <Button title={busy ? 'Väntar på svar …' : 'Skicka'} onPress={() => send(draft)} busy={busy} disabled={!draft.trim()} />
        </View>
      )}
    >
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        // To the newest message; an empty conversation stays at its greeting.
        onContentSizeChange={() => { if (!empty) scroll.current?.scrollToEnd({ animated: true }); }}
        onLayout={() => { if (!empty) scroll.current?.scrollToEnd({ animated: false }); }}
        contentContainerStyle={{ paddingBottom: space.l }}
        keyboardShouldPersistTaps="handled"
      >
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[type.body, { fontWeight: '600', flexShrink: 1 }]} numberOfLines={1}>{session ? sessionTitle(session) : 'Nytt samtal'}</Text>
          <Row style={{ gap: space.xs }}>
            <Button kind="ghost" title={`Samtal (${count})`} label={`Alla samtal, ${count}`} onPress={() => nav.push({ name: 'chatSessions' })} />
            <Button kind="ghost" title="Nytt" label="Nytt samtal" onPress={fresh} />
          </Row>
        </Row>

        {ready === false ? (
          <Card style={{ marginTop: space.m }}>
            <P>Prata använder språkmodellen du kopplat till appen. Ingen är kopplad än.</P>
            <Button title="Koppla en språkmodell" onPress={() => nav.push({ name: 'llm' })} style={{ marginTop: space.m }} />
          </Card>
        ) : null}

        {akutShown ? <View style={{ marginTop: space.m }}><CrisisCard plan={repo.plan()} /></View> : null}
        {mildShown ? <View style={{ marginTop: space.m }}><CrisisCard plan={repo.plan()} mild /></View> : null}

        {empty && ready !== false ? (
          <View style={{ marginTop: space.m }}>
            <P>Hej. Vad vill du prata om? Skriv fritt, eller börja med något av det här.</P>
            <Row style={{ gap: 6, marginTop: space.s }}>
              {CHAT_OPENERS.map((o) => <Chip key={o} label={o} onPress={() => setDraft(o)} />)}
            </Row>
          </View>
        ) : null}

        {ready !== false && !empty ? (
          // In a conversation: a small button; the explanation is on the empty page.
          <Button kind="secondary" title="Gå igenom en händelse steg för steg" disabled={busy} onPress={() => send(SORK_STARTER)} style={{ marginTop: space.s }} hint="Startar en SORK-genomgång, en fråga i taget" />
        ) : null}

        {ready !== false && empty ? (
          <Card style={{ marginTop: space.m }}>
            <Text style={[type.body, { fontWeight: '600' }]}>Gå igenom en händelse</Text>
            <P muted>Steg för steg: vad som hände, hur du mådde då, vad du tänkte, kände och gjorde, och vad som hände sedan. Metoden heter SORK. I slutet får du ett kort att godkänna.</P>
            {sorkHelp ? (
              <P style={{ marginTop: space.xs }}>Du behöver inte veta allt från början. Prata ställer en fråga i taget, och du kan avbryta när du vill.</P>
            ) : null}
            <Row style={{ gap: space.s, marginTop: space.s }}>
              <Button kind="secondary" title="Börja" label="Börja gå igenom en händelse" disabled={busy} onPress={() => send(SORK_STARTER)} />
              {!sorkHelp ? <Button kind="ghost" title="Hur går det till?" onPress={() => setSorkHelp(true)} /> : null}
            </Row>
          </Card>
        ) : null}

        <View style={{ marginTop: space.l, gap: space.s }}>
          {messages.map((m, i) => (
            <Bubble
              key={m.at + i}
              mine={m.role === 'user'}
              who={m.role === 'user' ? 'Du' : 'Prata'}
              text={m.text}
              at={m.at}
              note={m.akut === 'full' ? ' Skickades inte: Hjälp nu visas i stället.' : m.replaced ? ' Modellens svar bröt mot reglerna och ersattes av appens text.' : undefined}
            />
          ))}
          {pending ? (
            <>
              {/* Shown at once; once saved it is among the messages above, and not shown twice. */}
              {messages[messages.length - 1]?.role === 'user' && messages[messages.length - 1]?.text === pending.text ? null : <Bubble mine who="Du" text={pending.text} at={pending.at} />}
              <Waiting />
            </>
          ) : null}
        </View>

        {drafts.map((c) => (
          <Card key={c.id} style={{ marginTop: space.m }}>
            <Row style={{ gap: space.s, alignItems: 'center' }}>
              <Text style={[type.body, { fontWeight: '600' }]}>Ditt SORK-kort</Text>
              <Tag label="Utkast" />
            </Row>
            {([[SORK_LABELS[0], c.situation], [SORK_LABELS[1], c.organism], [SORK_LABELS[2], c.reaktion], [SORK_LABELS[3], c.konsekvens]] as const).map(([k, v]) => (v ? (
              <View key={k} style={{ marginTop: space.s }}>
                <Text style={[type.small, { fontWeight: '600' }]}>{k}</Text>
                <P>{v}</P>
              </View>
            ) : null))}
            <P muted style={{ marginTop: space.s }}>Stämmer det? Kortet följer med i nästa samtal först när du sparat det.</P>
            <Row style={{ gap: space.s, marginTop: space.xs }}>
              <Button title="Stämmer, spara kortet" onPress={() => approveSork(repo, c.id)} />
              <Button kind="ghost" title="Ta bort" label="Ta bort utkastet" onPress={() => deleteSork(repo, c.id)} />
            </Row>
          </Card>
        ))}

        {error ? <Card tone="yellow" style={{ marginTop: space.m }}><P>{error}</P></Card> : null}
        {notice || pendingFromChat ? (
          <Card style={{ marginTop: space.m }}>
            <P>{notice ?? `${pendingFromChat === 1 ? 'Ett förslag' : `${pendingFromChat} förslag`} från samtalen väntar på dig.`}</P>
            {pendingFromChat ? <Button kind="secondary" title="Granska förslagen" onPress={() => nav.push({ name: 'suggestions' })} style={{ marginTop: space.s }} /> : null}
          </Card>
        ) : null}

        <Row style={{ gap: space.s, flexWrap: 'wrap', marginTop: space.l }}>
          <Button kind="ghost" title="SORK-kort" onPress={() => nav.push({ name: 'sork' })} />
          <Button kind="ghost" title="Prompten" onPress={() => nav.push({ name: 'chatPrompt' })} hint="Visar och ändrar hur samtalet går till" />
          {messages.length ? <Button kind="ghost" title="Radera samtalet" onPress={remove} /> : null}
        </Row>
        <P muted style={{ marginTop: space.s }}>Experimentellt. Ett samtalsstöd med din plan som grund, inte vård. Vid akut fara: ring 112.</P>
      </ScrollView>
    </Screen>
  );
}

/** Every conversation, newest first: open one, or delete it. */
export function ChatSessionsScreen() {
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
  const list = chatSessions(repo);
  const current = currentSession(repo)?.id;
  return (
    <Screen title="Samtal">
      <Button title="Nytt samtal" onPress={async () => { await newSession(repo); nav.back(); }} />
      {!list.length ? <P muted style={{ marginTop: space.l }}>Inga samtal än.</P> : null}
      {list.map((s) => (
        <Card key={s.id} style={{ marginTop: space.m }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Öppna samtalet ${sessionTitle(s)}, ${formatDateSv(s.startedAt.slice(0, 10))}, ${s.messages.length} meddelanden`}
            onPress={async () => { await openSession(repo, s.id); nav.back(); }}
            style={({ pressed }) => ({ minHeight: MIN_TOUCH, opacity: pressed ? 0.6 : 1 })}
          >
            <Row style={{ gap: space.s, alignItems: 'center' }}>
              <Text style={[type.body, { fontWeight: '600', flexShrink: 1 }]}>{sessionTitle(s)}</Text>
              {s.id === current ? <Tag label="Öppet" /> : null}
            </Row>
            <Text style={type.small}>{`${formatDateSv(s.startedAt.slice(0, 10))} · ${s.messages.length} ${s.messages.length === 1 ? 'meddelande' : 'meddelanden'}`}</Text>
          </Pressable>
          <Button
            kind="ghost"
            title="Radera"
            label={`Radera samtalet ${sessionTitle(s)}`}
            onPress={async () => {
              if (await dialog.confirm({ title: 'Radera samtalet?', message: 'Samtalet tas bort från appen. SORK-kort och godkända rader finns kvar.', confirmLabel: 'Radera', danger: true })) await deleteSession(repo, s.id);
            }}
          />
        </Card>
      ))}
    </Screen>
  );
}

export function SorkScreen() {
  const repo = useRepo();
  const dialog = useDialog();
  const cards = sorkCards(repo);
  return (
    <Screen title="SORK-kort">
      <P muted>Händelser du gått igenom steg för steg i Prata och bekräftat: vad som hände, hur du mådde då, vad du tänkte, kände och gjorde, och vad som hände sedan. Metoden heter SORK.</P>
      {!cards.length ? <P style={{ marginTop: space.l }}>Inga SORK-kort än. Berätta i Prata om en händelse du vill förstå bättre.</P> : null}
      {cards.map((c) => (
        <Card key={c.id} style={{ marginTop: space.l }}>
          <Row style={{ gap: space.s, alignItems: 'center' }}>
            <Text style={type.label}>{formatDateSv(c.createdAt.slice(0, 10)).toUpperCase()}</Text>
            {c.approvedAt ? null : <Tag label="Utkast" />}
          </Row>
          {c.approvedAt ? null : <P muted style={{ marginTop: space.xs }}>Föreslaget av språkmodellen. Följer inte med i nästa samtal förrän du godkänt det.</P>}
          {([[SORK_LABELS[0], c.situation], [SORK_LABELS[1], c.organism], [SORK_LABELS[2], c.reaktion], [SORK_LABELS[3], c.konsekvens]] as const).map(([k, v]) => (v ? (
            <View key={k} style={{ marginTop: space.s }}>
              <Text style={[type.body, { fontWeight: '600' }]}>{k}</Text>
              <P>{v}</P>
            </View>
          ) : null))}
          {c.approvedAt ? null : (
            <Button title="Stämmer, spara kortet" label={`Godkänn SORK-kortet från ${formatDateSv(c.createdAt.slice(0, 10))}`} onPress={() => approveSork(repo, c.id)} style={{ marginTop: space.m }} />
          )}
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
