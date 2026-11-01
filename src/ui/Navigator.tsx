// The app's navigators (see nav.tsx for how screens move between them).
//
// Root (native stack)
//   tabs: Hem, Avstämning, Trend, Jag. Each tab is a native stack with a large title on its
//         first screen and the same pushed screens (result, history, settings and so on).
//   sheets, presented modally (a page sheet on iPhone, swipe down to close):
//         crisis plan (with plan import as a second step), proposals, a correction, and the
//         crisis numbers.

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer, useRoute, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, useColorScheme } from 'react-native';
import { CrisisCard } from './CrisisCard';
import { Screen } from './components';
import { PUSHED, useNav, type RouteName } from './nav';
import { CheckinScreen } from './screens/CheckinScreen';
import { CorrectionScreen } from './screens/CorrectionScreen';
import { GarminScreen } from './screens/GarminScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ImportDiaryScreen } from './screens/ImportDiaryScreen';
import { KnowledgeScreen } from './screens/KnowledgeScreen';
import { LlmSettingsScreen } from './screens/LlmSettingsScreen';
import { MeScreen } from './screens/MeScreen';
import { PlanImportScreen } from './screens/PlanImportScreen';
import { PlanScreen } from './screens/PlanScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { RecomputeScreen } from './screens/RecomputeScreen';
import { RoutinesScreen } from './screens/RoutinesScreen';
import { VisitScreen } from './screens/VisitScreen';
import { ResultScreen } from './screens/ResultScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SuggestionsScreen } from './screens/SuggestionsScreen';
import { TrendScreen } from './screens/TrendScreen';
import { useRepo } from './state';
import { MIN_TOUCH, paletteHex } from './theme';

const Root = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function ResultRoute() {
  const params = useRoute().params as { entryId: string };
  return <ResultScreen entryId={params.entryId} />;
}

function CorrectionRoute() {
  const params = useRoute().params as { assessmentId: string };
  return <CorrectionScreen assessmentId={params.assessmentId} />;
}

function CrisisSheet() {
  const repo = useRepo();
  return (
    <Screen title="Hjälp nu">
      <CrisisCard plan={repo.plan()} sheet />
    </Screen>
  );
}

const COMPONENT: Record<RouteName, React.ComponentType> = {
  home: HomeScreen,
  checkin: CheckinScreen,
  trend: TrendScreen,
  me: MeScreen,
  result: ResultRoute,
  plan: PlanScreen,
  planImport: PlanImportScreen,
  settings: SettingsScreen,
  llm: LlmSettingsScreen,
  garmin: GarminScreen,
  suggestions: SuggestionsScreen,
  knowledge: KnowledgeScreen,
  privacy: PrivacyScreen,
  history: HistoryScreen,
  importDiary: ImportDiaryScreen,
  routines: RoutinesScreen,
  recompute: RecomputeScreen,
  visit: VisitScreen,
  correction: CorrectionRoute,
  crisis: CrisisSheet,
};

/** Titles set before the screen renders, so the header never flashes empty. Under 15 characters (HIG). */
const TITLE: Record<RouteName, string> = {
  home: 'Dagsljus',
  checkin: 'Avstämning',
  trend: 'Trend',
  me: 'Jag',
  result: 'Bedömning',
  plan: 'Min krisplan',
  planImport: 'Lägg in plan',
  settings: 'Inställningar',
  llm: 'Språkmodell',
  garmin: 'Garmin',
  suggestions: 'Förslag',
  knowledge: 'Det appen vet',
  privacy: 'Integritet',
  history: 'Alla dagar',
  importDiary: 'Importera',
  routines: 'Rutiner',
  recompute: 'Räkna om',
  visit: 'Återbesök',
  correction: 'Stämmer det?',
  crisis: 'Hjälp nu',
};

/** Reduce Motion: stack pushes fade instead of slide. */
function useReduceMotion(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setOn).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOn);
    return () => sub.remove();
  }, []);
  return on;
}

/** "Hjälp nu" in the top bar of every tab: the crisis numbers and the plan's red steps, one tap away. */
function HelpButton() {
  const nav = useNav();
  const mode = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Hjälp nu"
      accessibilityHint="Visar krisnummer och din plan vid rött"
      onPress={() => nav.push({ name: 'crisis' })}
      hitSlop={8}
      style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 4 }}
    >
      <Text style={{ fontSize: 17, fontWeight: '600', color: paletteHex('red', mode) }} maxFontSizeMultiplier={1.6}>Hjälp nu</Text>
    </Pressable>
  );
}

function CloseButton() {
  const nav = useNav();
  const mode = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Stäng"
      onPress={nav.close}
      hitSlop={8}
      style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: 'center', alignItems: 'center' }}
    >
      <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} tintColor={paletteHex('textMuted', mode)} fallback={<Text style={{ fontSize: 20 }}>✕</Text>} />
    </Pressable>
  );
}

function stackOptions(reduceMotion: boolean): NativeStackNavigationOptions {
  return {
    animation: reduceMotion ? 'fade' : 'default',
    headerLargeTitleShadowVisible: false,
    headerShadowVisible: false,
    headerTransparent: false,
  };
}

function makeTabStack(first: RouteName) {
  return function TabStack() {
    const reduceMotion = useReduceMotion();
    return (
      <Stack.Navigator initialRouteName={first} screenOptions={stackOptions(reduceMotion)}>
        <Stack.Screen
          name={first}
          component={COMPONENT[first]}
          options={{ title: TITLE[first], headerLargeTitleEnabled: true, headerRight: () => <HelpButton /> }}
        />
        {PUSHED.map((name) => (
          <Stack.Screen key={name} name={name} component={COMPONENT[name]} options={{ title: TITLE[name] }} />
        ))}
      </Stack.Navigator>
    );
  };
}

function makeSheetStack(screens: RouteName[]) {
  return function SheetStack() {
    const reduceMotion = useReduceMotion();
    return (
      <Stack.Navigator screenOptions={stackOptions(reduceMotion)}>
        {screens.map((name, i) => (
          <Stack.Screen
            key={name}
            name={name}
            component={COMPONENT[name]}
            // HIG: a standard close symbol on the first step; later steps get the standard back button.
            options={{ title: TITLE[name], ...(i === 0 ? { headerLeft: () => <CloseButton /> } : {}) }}
          />
        ))}
      </Stack.Navigator>
    );
  };
}

const HomeStack = makeTabStack('home');
const CheckinStack = makeTabStack('checkin');
const TrendStack = makeTabStack('trend');
const MeStack = makeTabStack('me');
const PlanSheet = makeSheetStack(['plan', 'planImport']);
const SuggestionsSheet = makeSheetStack(['suggestions']);
const CorrectionSheet = makeSheetStack(['correction']);
const CrisisSheetStack = makeSheetStack(['crisis']);

type SymbolName = SymbolViewProps['name'];

function tabIcon(name: SymbolName, fallback: string) {
  return function TabIcon({ color, size }: { color: string; size: number }) {
    return <SymbolView name={name} size={size} tintColor={color} fallback={<Text style={{ color, fontSize: size * 0.8 }}>{fallback}</Text>} />;
  };
}

function TabsNavigator() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="homeTab" component={HomeStack} options={{ title: 'Hem', tabBarIcon: tabIcon({ ios: 'house.fill', android: 'home', web: 'home' }, '⌂') }} />
      <Tabs.Screen name="checkinTab" component={CheckinStack} options={{ title: 'Avstämning', tabBarIcon: tabIcon({ ios: 'square.and.pencil', android: 'edit_note', web: 'edit_note' }, '✎') }} />
      <Tabs.Screen name="trendTab" component={TrendStack} options={{ title: 'Trend', tabBarIcon: tabIcon({ ios: 'chart.line.uptrend.xyaxis', android: 'monitoring', web: 'monitoring' }, '↗') }} />
      <Tabs.Screen name="meTab" component={MeStack} options={{ title: 'Jag', tabBarIcon: tabIcon({ ios: 'person.crop.circle.fill', android: 'person', web: 'person' }, '◉') }} />
    </Tabs.Navigator>
  );
}

/** React Navigation's own colours, from the same palette as the rest of the app. */
function navTheme(dark: boolean): Theme {
  const mode = dark ? 'dark' : 'light';
  const base = dark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: paletteHex('accent', mode),
      background: paletteHex('bg', mode),
      card: paletteHex('surface', mode),
      text: paletteHex('text', mode),
      border: paletteHex('border', mode),
      notification: paletteHex('red', mode),
    },
  };
}

export function AppNavigator() {
  const dark = useColorScheme() === 'dark';
  const reduceMotion = useReduceMotion();
  return (
    <NavigationContainer theme={navTheme(dark)}>
      <Root.Navigator screenOptions={{ headerShown: false, animation: reduceMotion ? 'fade' : 'default' }}>
        <Root.Screen name="tabs" component={TabsNavigator} />
        <Root.Group screenOptions={{ presentation: 'modal' }}>
          <Root.Screen name="planSheet" component={PlanSheet} />
          <Root.Screen name="suggestionsSheet" component={SuggestionsSheet} />
          <Root.Screen name="correctionSheet" component={CorrectionSheet} />
          <Root.Screen name="crisisSheet" component={CrisisSheetStack} />
        </Root.Group>
      </Root.Navigator>
    </NavigationContainer>
  );
}
