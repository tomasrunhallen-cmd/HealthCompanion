import React from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Level } from '../domain/types';
import { useNav } from './nav';
import { colors, LEVEL_TEXT, levelColor, levelSoft, radius, space, type } from './theme';

export function Screen(props: {
  title?: string;
  back?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const nav = useNav();
  const body = (
    <View style={styles.inner}>
      {(props.title || props.back) && (
        <View style={styles.header}>
          {props.back && nav.canGoBack && (
            <Pressable accessibilityRole="button" accessibilityLabel="Tillbaka" onPress={nav.back} hitSlop={12} style={styles.backBtn}>
              <Text style={styles.backText}>‹ Tillbaka</Text>
            </Pressable>
          )}
          {props.title ? <Text style={type.title} accessibilityRole="header">{props.title}</Text> : null}
        </View>
      )}
      {props.children}
    </View>
  );
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {props.scroll === false ? body : (
        <ScrollView contentContainerStyle={{ paddingBottom: space.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      )}
      {props.footer ? <View style={[styles.footer, { paddingBottom: space.m + insets.bottom }]}>{props.footer}</View> : null}
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
  const fg = kind === 'primary' || kind === 'danger' ? '#fff' : kind === 'ghost' ? colors.accent : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!props.disabled }}
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

export function Chip(props: { label: string; selected?: boolean; onPress?: () => void; color?: string }) {
  const c = props.color ?? colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!props.selected }}
      onPress={props.onPress}
      style={[styles.chip, props.selected ? { backgroundColor: c, borderColor: c } : null]}
    >
      <Text style={[styles.chipText, props.selected ? { color: '#fff' } : null]}>{props.label}</Text>
    </Pressable>
  );
}

export function LevelLight(props: { level: Level; size?: number }) {
  const size = props.size ?? 88;
  return (
    <View style={{ alignItems: 'center' }} accessible accessibilityLabel={`Nivå: ${LEVEL_TEXT[props.level]}`}>
      <View style={styles.light}>
        {(['red', 'yellow', 'green'] as Level[]).map((l) => (
          <View
            key={l}
            style={{
              width: size / 2.6, height: size / 2.6, borderRadius: size, marginVertical: 3,
              backgroundColor: l === props.level ? levelColor(l) : '#D8D2C8',
            }}
          />
        ))}
      </View>
      <Text style={[type.h2, { color: levelColor(props.level), marginTop: space.s }]}>{LEVEL_TEXT[props.level]}</Text>
    </View>
  );
}

export function Dot(props: { level: Level | null; size?: number }) {
  const s = props.size ?? 14;
  return (
    <View
      style={{
        width: s, height: s, borderRadius: s,
        backgroundColor: props.level ? levelColor(props.level) : 'transparent',
        borderWidth: props.level ? 0 : 1.5, borderColor: colors.border,
      }}
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
        <Text style={type.h2}>{props.title}</Text>
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
  header: { marginBottom: space.l },
  backBtn: { paddingVertical: space.xs, marginBottom: space.xs, alignSelf: 'flex-start' },
  backText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  footer: {
    paddingHorizontal: space.l, paddingTop: space.m, borderTopWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  card: { borderRadius: radius.l, padding: space.l, marginBottom: space.m, borderWidth: 1, borderColor: colors.border },
  button: {
    minHeight: 48, borderRadius: radius.m, paddingHorizontal: space.l, alignItems: 'center',
    justifyContent: 'center', marginVertical: space.xs,
  },
  buttonBig: { minHeight: 60, borderRadius: radius.l },
  buttonText: { fontSize: 16, fontWeight: '700' },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: space.m,
    paddingVertical: 6, backgroundColor: colors.surface,
  },
  chipText: { fontSize: 14, color: colors.text, fontWeight: '600' },
  light: { backgroundColor: '#3B3935', borderRadius: 28, paddingHorizontal: 10, paddingVertical: 8 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.m, backgroundColor: colors.surface,
    paddingHorizontal: space.m, paddingVertical: space.m, fontSize: 16, color: colors.text,
  },
});
