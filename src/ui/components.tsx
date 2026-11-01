import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { SymbolView } from 'expo-symbols';
import React, { useContext, useLayoutEffect } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
  type ColorValue, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Level } from '../core/domain/types';
import { colors, LEVEL_TEXT, levelColor, levelSoft, MIN_TOUCH, radius, space, type } from './theme';

/**
 * A screen inside a native stack. The title goes to the native navigation bar (large on
 * each tab's first screen); the content scrolls under it, which lets the large title
 * collapse (contentInsetAdjustmentBehavior). Safe areas: the bar and the tab bar handle
 * top and bottom; a footer outside the tabs, in a sheet, adds the bottom inset itself.
 */
export function Screen(props: {
  title?: string;
  /** Kept for older callers; the native back button is always there when there is somewhere to go. */
  back?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const tabBarHeight = useContext(BottomTabBarHeightContext);
  useLayoutEffect(() => {
    if (props.title) navigation.setOptions({ title: props.title });
  }, [navigation, props.title]);
  const bottom = tabBarHeight ? 0 : insets.bottom;
  const body = <View style={styles.inner}>{props.children}</View>;
  return (
    <View style={styles.screen}>
      {props.scroll === false ? body : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: space.xxl + (props.footer ? 0 : bottom) }}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      )}
      {props.footer ? <View style={[styles.footer, { paddingBottom: space.m + bottom }]}>{props.footer}</View> : null}
    </View>
  );
}

export function Card(props: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: Level | 'accent' }) {
  const bg = props.tone === 'accent' ? colors.accentSoft : props.tone ? levelSoft(props.tone) : colors.surface;
  return <View style={[styles.card, { backgroundColor: bg }, props.style]}>{props.children}</View>;
}

export function Button(props: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const kind = props.kind ?? 'primary';
  const bg =
    kind === 'primary' ? colors.accent : kind === 'danger' ? colors.danger : kind === 'secondary' ? colors.surfaceAlt : 'transparent';
  const fg = kind === 'primary' ? colors.onAccent : kind === 'danger' ? colors.onDanger : kind === 'ghost' ? colors.accent : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.title}
      accessibilityState={{ disabled: !!props.disabled, busy: !!props.busy }}
      disabled={props.disabled || props.busy}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        props.big && styles.buttonBig,
        { backgroundColor: bg, opacity: props.disabled ? 0.45 : pressed ? 0.8 : 1 },
        kind === 'secondary' && { borderWidth: 1, borderColor: colors.border },
        props.style,
      ]}
    >
      {props.busy ? <ActivityIndicator color={fg} /> : (
        <Text style={[styles.buttonText, props.big && { fontSize: 18 }, { color: fg }]}>{props.title}</Text>
      )}
    </Pressable>
  );
}

export function Chip(props: { label: string; selected?: boolean; onPress?: () => void; color?: ColorValue }) {
  const c = props.color ?? colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: !!props.selected }}
      onPress={props.onPress}
      style={[styles.chip, props.selected ? { backgroundColor: c, borderColor: c } : null]}
    >
      <Text style={[styles.chipText, props.selected ? { color: colors.onAccent } : null]}>{props.label}</Text>
    </Pressable>
  );
}

/** A switch with its label (HIG: Toggles). */
export function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TOUCH }}>
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { fontWeight: '600' }]}>{props.label}</Text>
        {props.hint ? <Text style={type.small}>{props.hint}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={props.label}
        accessibilityHint={props.hint}
        value={props.value}
        onValueChange={props.onChange}
        disabled={props.disabled}
        trackColor={{ true: colors.accent, false: colors.border }}
      />
    </View>
  );
}

/**
 * A segmented control (HIG: Segmented controls): two to four choices of the same kind, one
 * selected. Each segment is at least 44 points high and VoiceOver reads its label and state.
 */
export function Segmented<T extends string>(props: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={props.label} style={{ marginTop: space.s }}>
      <Text style={[type.label, { marginBottom: space.xs }]}>{props.label}</Text>
      <View style={styles.segmented}>
        {props.options.map((o) => {
          const on = o.value === props.value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityLabel={`${props.label}: ${o.label}`}
              accessibilityState={{ checked: on, selected: on }}
              onPress={() => props.onChange(o.value)}
              style={[styles.segment, on && styles.segmentOn]}
            >
              <Text style={[styles.segmentText, on && { color: colors.text, fontWeight: '700' }]} numberOfLines={2} maxFontSizeMultiplier={1.6}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Each level's own shape, so the level never rests on colour alone (HIG: Accessibility). */
const LEVEL_SYMBOL: Record<Level, { ios: string; material: string; fallback: string }> = {
  green: { ios: 'checkmark.circle.fill', material: 'check_circle', fallback: '●' },
  yellow: { ios: 'exclamationmark.triangle.fill', material: 'warning', fallback: '▲' },
  red: { ios: 'exclamationmark.octagon.fill', material: 'report', fallback: '◆' },
};

export function LevelSymbol(props: { level: Level; size?: number }) {
  const size = props.size ?? 24;
  const s = LEVEL_SYMBOL[props.level];
  return (
    <SymbolView
      name={{ ios: s.ios, android: s.material, web: s.material } as never}
      size={size}
      tintColor={levelColor(props.level) as string}
      accessibilityElementsHidden
      importantForAccessibility="no"
      fallback={<Text style={{ fontSize: size * 0.8, color: levelColor(props.level) }}>{s.fallback}</Text>}
    />
  );
}

/** The day's level: symbol, word and colour together. VoiceOver reads it as one element. */
export function LevelLight(props: { level: Level; size?: number }) {
  const size = props.size ?? 72;
  return (
    <View style={{ alignItems: 'center' }} accessible accessibilityRole="text" accessibilityLabel={`Nivå: ${LEVEL_TEXT[props.level]}`}>
      <LevelSymbol level={props.level} size={size} />
      <Text style={[type.title, { color: levelColor(props.level), marginTop: space.s }]}>{LEVEL_TEXT[props.level]}</Text>
    </View>
  );
}

/** A small level marker for lists: the level's symbol, or an empty ring for a day without level. */
export function Dot(props: { level: Level | null; size?: number }) {
  const s = props.size ?? 18;
  if (props.level) {
    return (
      <View accessible accessibilityLabel={LEVEL_TEXT[props.level]}>
        <LevelSymbol level={props.level} size={s} />
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel="Ingen bedömning"
      style={{ width: s, height: s, borderRadius: s, borderWidth: 1.5, borderColor: colors.border }}
    />
  );
}

export function Field(props: TextInputProps & { label?: string; hint?: string }) {
  const { label, hint, style, ...rest } = props;
  return (
    <View style={{ marginBottom: space.l }}>
      {label ? <Text style={[type.label, { marginBottom: space.xs }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textMuted}
        {...rest}
        style={[styles.input, rest.multiline && { minHeight: 120, textAlignVertical: 'top' }, style]}
      />
      {hint ? <Text style={[type.small, { marginTop: space.xs }]}>{hint}</Text> : null}
    </View>
  );
}

export function Section(props: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ marginTop: space.xl }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.s }}>
        <Text style={[type.h2, { flexShrink: 1 }]} accessibilityRole="header">{props.title}</Text>
        {props.right}
      </View>
      {props.children}
    </View>
  );
}

export function Row(props: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' }, props.style]}>{props.children}</View>;
}

export function P(props: { children: React.ReactNode; muted?: boolean; style?: any }) {
  return <Text style={[props.muted ? type.small : type.body, props.style]}>{props.children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  inner: { paddingHorizontal: space.l, paddingTop: space.m, maxWidth: 640, width: '100%', alignSelf: 'center' },
  footer: {
    paddingHorizontal: space.l, paddingTop: space.m, borderTopWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  segmented: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.m, padding: 2, gap: 2 },
  segment: { flex: 1, minHeight: MIN_TOUCH, borderRadius: radius.m - 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xs },
  segmentOn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  segmentText: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  card: { borderRadius: radius.l, padding: space.l, marginBottom: space.m, borderWidth: 1, borderColor: colors.border },
  button: {
    minHeight: 48, borderRadius: radius.m, paddingHorizontal: space.l, alignItems: 'center',
    justifyContent: 'center', marginVertical: space.xs,
  },
  buttonBig: { minHeight: 60, borderRadius: radius.l },
  buttonText: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: space.m,
    paddingVertical: space.s, minHeight: MIN_TOUCH, justifyContent: 'center', backgroundColor: colors.surface,
  },
  chipText: { fontSize: 15, color: colors.text, fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.m, backgroundColor: colors.surface,
    paddingHorizontal: space.m, paddingVertical: space.m, minHeight: MIN_TOUCH, fontSize: 17, color: colors.text,
  },
});
