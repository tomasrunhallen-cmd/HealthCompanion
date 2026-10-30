import React from 'react';
import { Text } from 'react-native';
import { Card, P, Screen, Section } from '../components';
import { useRepo } from '../state';
import { colors, space, type } from '../theme';

const FLOW: { title: string; text: string }[] = [
  { title: 'Krisplan, anteckningar och bedömningar', text: 'Sparas bara på den här telefonen. Det finns ingen server och inget konto.' },
  { title: 'Ljud', text: 'Spelas in lokalt och raderas i samma steg som texten sparas (när inspelning finns, efter steg 1).' },
  { title: 'Bedömningen', text: 'Räknas i appen på telefonen. Just nu används ordmatchning; ingen text lämnar telefonen.' },
  { title: 'Språkmodell (från steg 2)', text: 'Bara rensad text, utan namn, telefonnummer, personnummer, adresser och länkar, skickas till den leverantör du själv väljer. Leverantörens egna villkor gäller. Du får se vilken leverantör innan första anropet.' },
  { title: 'Garmin (från steg 3)', text: 'Appen hämtar din sömn och stress från ditt eget Garmin-konto med din egen nyckel.' },
  { title: 'Ingen annan', text: 'Appen skickar aldrig meddelanden, notiser eller data till någon annan person. Inga analysverktyg, ingen reklam, ingen kraschrapportering.' },
  { title: 'Backup', text: 'Bara som lösenordsskyddad exportfil som du själv sparar.' },
];

export function PrivacyScreen() {
  const repo = useRepo();
  const info = repo.storageInfo();
  return (
    <Screen title="Data och integritet" back>
      <Card tone={info.encrypted ? 'green' : 'yellow'}>
        <Text style={type.h2}>Lagring på den här enheten</Text>
        <P style={{ marginTop: space.xs }}>{info.detail}</P>
        <P muted style={{ marginTop: space.xs }}>
          Kryptering: {info.encrypted === true ? 'på (SQLCipher)' : info.encrypted === false ? 'av' : 'okänd'}
        </P>
      </Card>

      <Section title="Vart din data tar vägen">
        {FLOW.map((f) => (
          <Card key={f.title}>
            <Text style={[type.body, { fontWeight: '700' }]}>{f.title}</Text>
            <P style={{ marginTop: space.xs }}>{f.text}</P>
          </Card>
        ))}
      </Section>

      <P muted style={{ marginTop: space.l, color: colors.textMuted }}>
        Appen ställer ingen diagnos och ersätter inte vården. Den visar bara det som står i din egen plan.
      </P>
    </Screen>
  );
}
