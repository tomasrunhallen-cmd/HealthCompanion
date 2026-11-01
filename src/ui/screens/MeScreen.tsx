import { SymbolView } from 'expo-symbols';
import React from 'react';
import { Linking, Pressable, Text, useColorScheme, View } from 'react-native';
import { PRIVACY_POLICY_URL } from '../../legal';
import { Card, Screen, Section } from '../components';
import { useNav, type Route } from '../nav';
import { useRepo } from '../state';
import { colors, MIN_TOUCH, paletteHex, space, type } from '../theme';

/** One row in a grouped list: title, optional detail, and a chevron. At least 44 points tall. */
function ListRow(props: { title: string; detail?: string; to?: Route; url?: string; last?: boolean }) {
  const nav = useNav();
  const mode = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <Pressable
      accessibilityRole={props.url ? 'link' : 'button'}
      accessibilityLabel={props.detail ? `${props.title}, ${props.detail}` : props.title}
      onPress={() => (props.url ? Linking.openURL(props.url).catch(() => undefined) : props.to && nav.push(props.to))}
      style={({ pressed }) => ({
        minHeight: MIN_TOUCH, paddingVertical: space.m, flexDirection: 'row', alignItems: 'center', gap: space.m,
        borderBottomWidth: props.last ? 0 : 1, borderColor: colors.border, opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1 }}>
        <Text style={type.body}>{props.title}</Text>
        {props.detail ? <Text style={type.small}>{props.detail}</Text> : null}
      </View>
      <SymbolView
        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
        size={14}
        tintColor={paletteHex('textMuted', mode)}
        fallback={<Text style={type.small}>›</Text>}
      />
    </Pressable>
  );
}

/** The "Jag" tab: the crisis plan, what the app knows, settings and privacy. */
export function MeScreen() {
  const repo = useRepo();
  const pending = repo.pendingSuggestions().length;
  const signs = repo.plan().filter((p) => p.kind === 'early' || p.kind === 'serious').length;
  const routineCount = repo.contextOf('routine').length;
  return (
    <Screen title="Jag">
      <Section title="Min plan">
        <Card style={{ paddingVertical: 0 }}>
          <ListRow title="Min krisplan" detail={signs ? `${signs} tecken` : 'Inga tecken än'} to={{ name: 'plan' }} />
          <ListRow title="Rutiner" detail={routineCount ? `${routineCount} ur planen, påminnelser och avbockning` : 'Påminnelser och avbockning'} to={{ name: 'routines' }} last={!pending} />
          {pending ? <ListRow title="Förslag att granska" detail={`${pending} väntar`} to={{ name: 'suggestions' }} last /> : null}
        </Card>
      </Section>
      <Section title="Det appen vet">
        <Card style={{ paddingVertical: 0 }}>
          <ListRow title="Inför återbesök" detail="14 eller 30 dagar, och det du vill ta upp" to={{ name: 'visit' }} />
          <ListRow title="Visa för någon" detail="Ampel, sömn och tecken, utan anteckningar" to={{ name: 'share' }} />
          <ListRow title="Det appen vet om mig" to={{ name: 'knowledge' }} />
          <ListRow title="Alla dagar" to={{ name: 'history' }} last />
        </Card>
      </Section>
      <Section title="Appen">
        <Card style={{ paddingVertical: 0 }}>
          <ListRow title="Inställningar" detail="Påminnelse, applås, språkmodell, Garmin, export" to={{ name: 'settings' }} />
          <ListRow title="Data och integritet" to={{ name: 'privacy' }} />
          <ListRow title="Integritetspolicy" detail="Öppnas i webbläsaren" url={PRIVACY_POLICY_URL} last />
        </Card>
      </Section>
    </Screen>
  );
}
