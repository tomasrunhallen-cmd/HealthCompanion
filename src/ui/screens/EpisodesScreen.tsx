// Episodstarter: the dates the person documents for earlier episodes, with their type and where
// the date comes from (the person afterwards, or a clinical assessment). Kept apart from the rated
// mood and from the app's estimate. They are the comparison for Klockans rytm and the truth in its
// evaluation; the app's earlier colours never are.

import React, { useState } from 'react';
import { View } from 'react-native';
import { formatDateSvYear } from '../../core/analysis/dates';
import type { EpisodeSource, EpisodeType } from '../../core/analysis/rhythm';
import { newId } from '../../core/analysis/assess';
import { episodeStarts, removeEpisode, saveEpisode, updateRhythm } from '../../services/rhythm';
import { Button, Card, Field, P, Screen, Section, Segmented } from '../components';
import { useRepo } from '../state';
import { space } from '../theme';

const TYPE: Record<EpisodeType, string> = { up: 'Uppvarvad', down: 'Nedstämd', mixed: 'Blandad' };
const SOURCE: Record<EpisodeSource, string> = { self_retro: 'Jag, i efterhand', clinical: 'Klinisk bedömning' };
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function EpisodesScreen() {
  const repo = useRepo();
  const list = episodeStarts(repo).slice().reverse();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [kind, setKind] = useState<EpisodeType>('up');
  const [source, setSource] = useState<EpisodeSource>('self_retro');
  const ok = isDate(start) && (!end || (isDate(end) && end >= start));

  const add = async () => {
    await saveEpisode(repo, { id: newId('ep'), start, end: end || null, type: kind, source, createdAt: new Date().toISOString() });
    setStart('');
    setEnd('');
    await updateRhythm(repo);
  };

  return (
    <Screen title="Episodstarter">
      <P>Dagar då en period började. De används för att jämföra klockans rytm med din historik, och som facit när modellen utvärderas.</P>
      <Section title="Lägg till">
        <Card>
          <Field label="Startdatum" placeholder="ÅÅÅÅ-MM-DD" value={start} onChangeText={setStart} autoCapitalize="none" inputMode="numeric" />
          <Field label="Slutdatum, om du vet" placeholder="ÅÅÅÅ-MM-DD" value={end} onChangeText={setEnd} autoCapitalize="none" inputMode="numeric" hint="Utan slutdatum räknas perioden som fyra veckor." />
          <Segmented<EpisodeType> label="Typ" options={(Object.keys(TYPE) as EpisodeType[]).map((v) => ({ value: v, label: TYPE[v] }))} value={kind} onChange={setKind} />
          <Segmented<EpisodeSource> label="Datumet kommer från" options={(Object.keys(SOURCE) as EpisodeSource[]).map((v) => ({ value: v, label: SOURCE[v] }))} value={source} onChange={setSource} />
          <Button title="Spara" disabled={!ok} onPress={add} />
        </Card>
      </Section>
      <Section title={list.length ? `${list.length} sparade` : 'Inga sparade'}>
        {list.map((e) => (
          <Card key={e.id}>
            <P>{TYPE[e.type]} från {formatDateSvYear(e.start)}{e.end ? ` till ${formatDateSvYear(e.end)}` : ''}</P>
            <P muted>{SOURCE[e.source]}</P>
            <View style={{ marginTop: space.xs }}>
              <Button kind="ghost" title="Ta bort" onPress={async () => { await removeEpisode(repo, e.id); await updateRhythm(repo); }} />
            </View>
          </Card>
        ))}
      </Section>
    </Screen>
  );
}
