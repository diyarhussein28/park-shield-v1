import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t, type Key } from '@/lib/i18n';
import { space, type as typeScale, useTheme } from '@/theme/tokens';
import { Icon, type IconName } from './icons';

/** The four tabs (owner decision 2026-11-20), in order: route name → label and icon. */
export const TABS: Record<string, { label: Key; icon: IconName }> = {
  index: { label: 'tabHome', icon: 'home' },
  alerts: { label: 'tabAlerts', icon: 'bell' },
  fahrzeuge: { label: 'tabVehicles', icon: 'car' },
  konto: { label: 'tabAccount', icon: 'user' },
};

/** What expo-router 58 hands a custom tab bar (only the parts this bar uses). */
export interface BrandTabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  emitter: {
    emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => {
      defaultPrevented: boolean;
    };
  };
  navigateToTab: (routeKey: string) => void;
  insets: { bottom: number };
  /** Badge counts by route name, e.g. open alerts on `index`. */
  badges?: Record<string, number>;
}

/**
 * The branded bottom tab bar: website icons and colours, labels on one line even at large text sizes,
 * a badge for open alerts. Each tab is ≥ 56 pt high, plus the bottom safe area.
 */
export function BrandTabBar({ state, emitter, navigateToTab, insets, badges }: BrandTabBarProps) {
  const c = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        s.bar,
        { backgroundColor: c.bg, borderTopColor: c.border, paddingBottom: insets.bottom },
      ]}
    >
      {state.routes.map((route, i) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const focused = i === state.index;
        const label = t(tab.label);
        const count = badges?.[route.name] ?? 0;
        const badge = count > 99 ? '99+' : count > 0 ? String(count) : null;
        const color = focused ? c.primary : c.muted;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={badge ? `${label}, ${badge}` : label}
            accessibilityState={{ selected: focused }}
            onPress={() => {
              const e = emitter.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !e.defaultPrevented) navigateToTab(route.key);
            }}
            style={({ pressed }) => [s.tab, { opacity: pressed ? 0.85 : 1 }]}
          >
            <View>
              <Icon name={tab.icon} size={24} color={color} />
              {badge && (
                <View
                  testID="tab-badge"
                  style={[s.badge, { backgroundColor: c.urgent, borderColor: c.bg }]}
                >
                  <Text maxFontSizeMultiplier={1.4} style={[s.badgeText, { color: c.dangerFg }]}>
                    {badge}
                  </Text>
                </View>
              )}
            </View>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              // Like the system tab bar: labels grow a little with Dynamic Type, then shrink to fit.
              maxFontSizeMultiplier={1.4}
              minimumFontScale={0.7}
              style={[typeScale.caption, { color, fontWeight: focused ? '800' : '600' }]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingTop: space.sm,
  },
  badge: {
    position: 'absolute',
    top: -6,
    left: 14,
    minWidth: 20,
    minHeight: 20,
    borderRadius: 999,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '800' },
});
