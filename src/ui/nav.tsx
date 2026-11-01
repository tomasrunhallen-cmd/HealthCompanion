// A small stack navigator kept in React state. It never touches the URL, so the
// same build runs in Expo Go, in a development build and as a web preview.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BackHandler } from 'react-native';

export type Route =
  | { name: 'home' }
  | { name: 'checkin' }
  | { name: 'result'; entryId: string; fresh?: boolean }
  | { name: 'plan' }
  | { name: 'planImport' }
  | { name: 'settings' }
  | { name: 'llm' }
  | { name: 'garmin' }
  | { name: 'suggestions' }
  | { name: 'knowledge' }
  | { name: 'privacy' }
  | { name: 'history' };

interface Nav {
  route: Route;
  canGoBack: boolean;
  push(route: Route): void;
  replace(route: Route): void;
  back(): void;
  reset(route?: Route): void;
}

const NavContext = createContext<Nav | null>(null);

export function NavProvider(props: { children: (route: Route) => React.ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const replace = useCallback((r: Route) => setStack((s) => [...s.slice(0, -1), r]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback((r: Route = { name: 'home' }) => setStack([r]), []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, back]);

  const route = stack[stack.length - 1];
  const value = useMemo<Nav>(
    () => ({ route, canGoBack: stack.length > 1, push, replace, back, reset }),
    [route, stack.length, push, replace, back, reset],
  );
  return <NavContext.Provider value={value}>{props.children(route)}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav utanför NavProvider');
  return nav;
}
