import React from 'react';
import { Text } from 'react-native';
import { PROVIDERS } from '../../adapter/providers';
import { hasConsent, isLocalDestination } from '../../llm/config';
import { Card, P, Screen, Section } from '../components';
import { useRepo } from '../state';
import { colors, space, type } from '../theme';

const FLOW: { title: string; text: string }[] = [
  { title: 'Krisplan, anteckningar och bedömningar', text: 'Sparas bara på den här telefonen. Det finns ingen server och inget konto.' },
  { title: 'Ljud', text: 'Spelas in lokalt och raderas i samma steg som texten sparas (när inspelning finns, efter steg 1).' },
  { title: 'Bedömningen', text: 'Nivån räknas alltid i appen på telefonen. Utan språkmodell används ordmatchning och ingen text lämnar telefonen.' },
  { title: 'Språkmodell', text: 'Om du kopplar en språkmodell skickas bara rensad text, utan namn, telefonnummer, personnummer, adresser och länkar, till den leverantör du själv väljer, med din egen nyckel. Leverantörens egna villkor gäller. Du får se vart texten går innan första anropet. Nyckeln ligger i telefonens nyckelring.' },
  { title: 'Garmin', text: 'Om du ansluter Garmin hämtar appen sömn, stress och Body Battery från ditt eget konto med din egen nyckel. Inget av det du skriver skickas till Garmin. Med en språkmodell kopplad följer dagens och veckans sömn och stress med till bedömningen, som siffror utan namn.' },
  { title: 'Ingen annan', text: 'Appen skickar aldrig meddelanden, notiser eller data till någon annan person. Inga analysverktyg, ingen reklam, ingen kraschrapportering.' },
  { title: 'Backup', text: 'Bara som lösenordsskyddad exportfil som du själv sparar.' },
];

export function PrivacyScreen() {
  const repo = useRepo();
  const info = repo.storageInfo();
  const llm = repo.llmConfig();
  const active = !!llm.provider && hasConsent(llm);
  const destination = !active || !llm.provider
    ? 'Ingen text lämnar telefonen. Bedömningen görs med ordmatchning.'
    : isLocalDestination(llm.provider, llm.baseUrl)
      ? `Rensad text går till din egen server ${llm.baseUrl}. Den lämnar inte dina enheter.`
      : `Rensad text går till ${llm.provider === 'openai-compatible' ? llm.baseUrl : PROVIDERS[llm.provider].label} (${llm.model}) när du gör kvällens avstämning eller importerar en krisplan.`;
  return (
    <Screen title="Data och integritet" back>
      <Card tone={info.encrypted ? 'green' : 'yellow'}>
        <Text style={type.h2}>Lagring på den här enheten</Text>
        <P style={{ marginTop: space.xs }}>{info.detail}</P>
        <P muted style={{ marginTop: space.xs }}>
          Kryptering: {info.encrypted === true ? 'på (SQLCipher)' : info.encrypted === false ? 'av' : 'okänd'}
        </P>
      </Card>

      <Card tone={active ? 'accent' : 'green'}>
        <Text style={type.h2}>Just nu</Text>
        <P style={{ marginTop: space.xs }}>{destination}</P>
      </Card>

      <Section title="Vart din data tar vägen">
        {FLOW.map((f) => (info.kind === 'cloud' && f.title === 'Krisplan, anteckningar och bedömningar'
          ? { ...f, text: 'I webbversionen: i ditt eget Firebase-projekt, bakom din inloggning, och i den här webbläsaren. Bara ditt konto kan läsa dem enligt reglerna i Firestore.' }
          : info.kind === 'cloud' && f.title === 'Garmin'
            ? { ...f, text: `${f.text} I webbversionen går hämtningen via appens egen funktion på Netlify, eftersom Garmin inte tar emot anrop från webbläsare. Funktionen sparar ingenting.` }
            : f
        )).map((f) => (
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
