import type { Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import type { PortalVehicle, Protection } from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';
import { Icon } from './icons';
import { Button, Chip, ProgressBar, Section } from './ui';

/**
 * OW-14 / US-28 (web: the set-up guide on /konto): the protection score and the open steps, each
 * leading to its screen. Trusted contacts are PREMIUM only, so for PLUS that step is left out.
 */
export function SetupGuide({
  protection,
  vehicles,
  onGo,
}: {
  protection: Protection;
  vehicles: PortalVehicle[];
  onGo: (href: Href) => void;
}) {
  const c = useTheme();
  const first = vehicles[0] ?? null;
  const steps: {
    key: string;
    done: boolean;
    title: string;
    href: Href;
    go: string;
    optional?: boolean;
  }[] = [
    {
      key: 'vehicle',
      done: vehicles.length > 0,
      title: pt('setup.vehicleTitle'),
      href: '/fahrzeuge',
      go: pt('portal.createQr'),
    },
    {
      key: 'phone',
      done: protection.steps.channel,
      title: pt('protection.stepChannel'),
      href: '/benachrichtigungen',
      go: pt('protection.goChannel'),
    },
    {
      key: 'decal',
      done: protection.steps.decal,
      title: pt('protection.stepDecal'),
      href: first ? { pathname: '/fahrzeug/[id]', params: { id: first.id } } : '/fahrzeuge',
      go: pt('protection.goDecal'),
    },
    ...(protection.steps.contact === null
      ? []
      : [
          {
            key: 'contact',
            done: protection.steps.contact,
            title: pt('protection.stepContact'),
            href: '/einstellungen' as Href,
            go: pt('protection.goContact'),
            optional: true,
          },
        ]),
  ];
  const complete = protection.percent === 100 && vehicles.length > 0;
  const open = steps.filter((x) => !x.done).length;

  return (
    <Section
      title={pt('protection.title')}
      intro={complete ? pt('setup.allDone') : pt('setup.intro', { count: open })}
      style={complete ? undefined : { borderColor: c.primary, borderWidth: 2 }}
    >
      <Chip tone={complete ? 'ok' : 'warn'}>
        {complete ? pt('protection.complete') : pt('protection.incomplete')}
      </Chip>
      <Text style={[typeScale.label, { color: c.fg }]}>
        {pt('protection.percent', { percent: protection.percent })}
      </Text>
      <ProgressBar percent={protection.percent} label={pt('protection.title')} />
      {steps.map((x, i) => (
        <View key={x.key} style={[s.step, { borderColor: x.done ? c.border : c.primary }]}>
          <View style={s.stepHead}>
            <View
              style={[
                s.num,
                x.done ? { backgroundColor: c.successBg } : { backgroundColor: c.primary },
              ]}
            >
              {x.done ? (
                <Icon name="check" size={16} color={c.successFg} />
              ) : (
                <Text style={[typeScale.label, { color: c.primaryFg }]}>{i + 1}</Text>
              )}
            </View>
            <Text
              style={[
                typeScale.body,
                { flex: 1, fontWeight: '700', color: x.done ? c.muted : c.fg },
              ]}
            >
              {x.title}
              {x.optional && !x.done ? ` (${pt('common.optional')})` : ''}
            </Text>
          </View>
          {!x.done && <Button label={x.go} variant="secondary" onPress={() => onGo(x.href)} />}
        </View>
      ))}
    </Section>
  );
}

const s = StyleSheet.create({
  step: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  num: {
    minWidth: 28,
    minHeight: 28,
    paddingHorizontal: 4,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
