// Anhörigkort: what the people close to the person need, from the plan, as a PDF the person
// shares themselves. Made when the person is well.

import React from 'react';
import { Text, View } from 'react-native';
import { relativesCard, relativesCardHtml } from '../../core/report/relativesCard';
import { polarityWord } from '../../core/plan/fields';
import { sharePdf } from '../../platform/pdf';
import { planBlocks } from '../../services/planBlocks';
import { Button, Card, P, Screen, Section } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { space, type } from '../theme';

function List({ title, items, ordered = false }: { title: string; items: string[]; ordered?: boolean }) {
  return (
    <Section title={title}>
      <Card>
        {items.length ? items.map((t, i) => <P key={t + i} style={{ marginTop: i ? space.xs : 0 }}>{`${ordered ? `${i + 1}.` : '•'} ${t}`}</P>) : <P muted>Inget i planen än.</P>}
      </Card>
    </Section>
  );
}

export function RelativesScreen() {
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
  const card = relativesCard(planBlocks(repo));
  const ps = repo.planSettings();
  const signs = card.signsUp.length + card.signsDown.length + card.signsOther.length;
  return (
    <Screen
      title="Anhörigkort"
      footer={<Button big title="Spara som PDF" onPress={async () => {
        const res = await sharePdf(relativesCardHtml(card, ps), 'Till mina närstående.pdf');
        if (!res.ok) await dialog.info('PDF:en gick inte att skapa', res.message);
      }} />}
    >
      <P muted>Dina egna upplevelser och önskemål följer inte med.</P>
      <Section title="Tecken som andra kan se">
        <Card>
          {!signs ? (
            <>
              <P muted>Inga tecken är markerade som sådant andra ser. Välj Andra ser under ett block med tecken i Min krisplan.</P>
              <Button kind="ghost" title="Öppna Min krisplan" onPress={() => nav.push({ name: 'plan' })} />
            </>
          ) : null}
          {(['up', 'down'] as const).map((dir) => {
            const list = dir === 'up' ? card.signsUp : card.signsDown;
            return list.length ? (
              <View key={dir} style={{ marginBottom: space.s }}>
                <Text style={type.label}>{`NÄR JAG BLIR ${polarityWord(dir, ps).toUpperCase()}`}</Text>
                {list.map((t) => <P key={t}>{`• ${t}`}</P>)}
              </View>
            ) : null;
          })}
          {card.signsOther.map((t) => <P key={t}>{`• ${t}`}</P>)}
        </Card>
      </Section>
      <List title="Vid tidiga tecken" items={card.early} />
      <List title="Om det blir allvarligt" items={card.serious} />
      <List title="För att undvika tvångsåtgärder" items={card.ladder} ordered />
      <List title="Kontakter" items={card.contacts} />
    </Screen>
  );
}
