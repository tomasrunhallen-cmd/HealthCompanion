import React, { useState } from 'react';
import { Text } from 'react-native';
import { decideSuggestion } from '../../services/corrections';
import { KIND_TEXT } from '../../core/context/labels';
import { Button, Card, Field, P, Screen } from '../components';
import { useRepo } from '../state';
import { space, type } from '../theme';

const ACTION_TEXT = { add: 'Lägg till', update: 'Ändra till', remove: 'Ta bort', confirm: 'Gör till eget tecken' };

/** Proposals from corrections and profile updates, decided one at a time. */
export function SuggestionsScreen() {
  const repo = useRepo();
  const pending = repo.pendingSuggestions();
  const s = pending[0];
  // The edited text belongs to one proposal; the next proposal starts from its own text.
  const [draft, setDraft] = useState<{ id: string | undefined; text: string }>({ id: s?.id, text: s?.change.text ?? '' });
  const text = draft.id === s?.id ? draft.text : (s?.change.text ?? '');
  const setText = (t: string) => setDraft({ id: s?.id, text: t });

  return (
    <Screen title="Förslag" back>
      {!s ? (
        <P muted>Inga förslag väntar. Appen ändrar aldrig något om dig utan att du godkänt det.</P>
      ) : (
        <>
          <P muted>{`Förslag 1 av ${pending.length}. Inget sparas förrän du godkänt det.`}</P>
          <Card style={{ marginTop: space.m }}>
            <Text style={type.label}>{`${ACTION_TEXT[s.change.action].toUpperCase()}: ${KIND_TEXT[s.change.kind].toUpperCase()}`}</Text>
            {s.change.action === 'add' || s.change.action === 'update' ? (
              <Field value={text} onChangeText={setText} multiline style={{ minHeight: 80, marginTop: space.s }} />
            ) : (
              <P style={{ marginTop: space.s, fontWeight: '600' }}>{s.change.text}</P>
            )}
            <P>{s.reason}</P>
            {s.quotes.length ? (
              <>
                <Text style={[type.label, { marginTop: space.m }]}>GRUND</Text>
                {s.quotes.map((q, i) => <P key={q + i} muted style={{ fontStyle: 'italic', marginTop: space.xs }}>{`”${q}”`}</P>)}
              </>
            ) : null}
          </Card>
          <Button title="Godkänn" onPress={() => decideSuggestion(repo, s.id, true, text)} disabled={!text.trim() && s.change.action !== 'remove'} />
          <Button kind="secondary" title="Avvisa" onPress={() => decideSuggestion(repo, s.id, false)} />
        </>
      )}
    </Screen>
  );
}
