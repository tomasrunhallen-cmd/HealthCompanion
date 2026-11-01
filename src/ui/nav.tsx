// Navigation (HIG: Tab bars, Sheets, Toolbars). A native stack per tab with large titles
// on each tab's first screen, a tab bar with four tabs, and sheets for the crisis plan,
// corrections, proposals and the crisis numbers. React Navigation 7 with react-native-screens,
// which is in Expo Go, so the same build still runs in Expo Go, a development build and the
// web version. No Expo Router and no URLs.
//
// Screens keep using useNav() with the Route union below; this file maps a Route to the
// right tab, stack or sheet.

import { useNavigation, useRoute, type NavigationProp, type ParamListBase } from '@react-navigation/native';

export type Route =
  | { name: 'home' }
  | { name: 'checkin' }
  | { name: 'trend' }
  | { name: 'me' }
  | { name: 'result'; entryId: string; fresh?: boolean }
  | { name: 'plan' }
  | { name: 'planImport' }
  | { name: 'settings' }
  | { name: 'llm' }
  | { name: 'garmin' }
  | { name: 'suggestions' }
  | { name: 'knowledge' }
  | { name: 'privacy' }
  | { name: 'history' }
  | { name: 'importDiary' }
  | { name: 'correction'; assessmentId: string }
  | { name: 'crisis' };

export type RouteName = Route['name'];

/** The first screen of each tab. */
export const TAB_OF: Partial<Record<RouteName, string>> = {
  home: 'homeTab',
  checkin: 'checkinTab',
  trend: 'trendTab',
  me: 'meTab',
};

/** Routes shown as a sheet, and the sheet stack that holds them. */
export const SHEET_OF: Partial<Record<RouteName, string>> = {
  plan: 'planSheet',
  planImport: 'planSheet',
  suggestions: 'suggestionsSheet',
  correction: 'correctionSheet',
  crisis: 'crisisSheet',
};

/** Routes pushed onto the current tab's stack. Every tab stack has all of them. */
export const PUSHED: RouteName[] = ['result', 'settings', 'llm', 'garmin', 'knowledge', 'privacy', 'history', 'importDiary'];

interface Nav {
  route: Route;
  canGoBack: boolean;
  push(route: Route): void;
  replace(route: Route): void;
  back(): void;
  /** Back to Hem, first screen; used after a finished check-in. */
  reset(route?: Route): void;
  /** Closes the sheet this screen is in. */
  close(): void;
}

function paramsOf(route: Route): Record<string, unknown> | undefined {
  const { name: _name, ...rest } = route as Route & Record<string, unknown>;
  return Object.keys(rest).length ? rest : undefined;
}

/** The root navigator, from any depth. */
function rootOf(nav: NavigationProp<ParamListBase>): NavigationProp<ParamListBase> {
  let n = nav;
  while (n.getParent()) n = n.getParent()!;
  return n;
}

export function useNav(): Nav {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const r = useRoute();
  const route = { name: r.name, ...(r.params as object | undefined) } as Route;

  const push = (to: Route) => {
    const params = paramsOf(to);
    const root = rootOf(navigation);
    const tab = TAB_OF[to.name];
    if (tab) {
      root.navigate('tabs', { screen: tab, params: { screen: to.name } });
      return;
    }
    // Already in a stack that has this screen (a tab, or the sheet it belongs to): push there.
    const state = navigation.getState();
    if (state?.routeNames.includes(to.name)) {
      (navigation as unknown as { push(n: string, p?: object): void }).push(to.name, params);
      return;
    }
    const sheet = SHEET_OF[to.name];
    if (sheet) {
      // HIG: one sheet at a time. Opening another closes nothing here, since sheets do not open sheets.
      root.navigate(sheet, { screen: to.name, params });
      return;
    }
    root.navigate('tabs', { screen: 'homeTab', params: { screen: to.name, params } });
  };

  const replace = (to: Route) => {
    const state = navigation.getState();
    if (state?.routeNames.includes(to.name)) {
      (navigation as unknown as { replace(n: string, p?: object): void }).replace(to.name, paramsOf(to));
    } else push(to);
  };

  const back = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  const close = () => {
    const root = rootOf(navigation);
    if (root.canGoBack()) root.goBack();
  };

  const reset = (to: Route = { name: 'home' }) => {
    // Pop the current tab to its first screen, then show the target tab.
    const stack = navigation as unknown as { popToTop?: () => void };
    if (navigation.canGoBack()) stack.popToTop?.();
    push(to);
  };

  return { route, canGoBack: navigation.canGoBack(), push, replace, back, reset, close };
}
