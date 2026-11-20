import { PLAN_FEATURE_COUNTS } from '@parkshield/shared/plans';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/icons';
import { CheckoutForm } from '@/components/subscription';
import { Chip, Screen, Title, P } from '@/components/ui';
import { t } from '@/lib/i18n';
import { pt, type MessageKey } from '@/lib/portal-i18n';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';

type Plan = 'plus' | 'premium';

/** One plan with its benefits from the pricing page (landing.<plan>F1 … Fn). */
function PlanCard({ plan, available }: { plan: Plan; available: boolean }) {
  const c = useTheme();
  const price = plan === 'plus' ? '10 €' : '15 €';
  return (
    <View
      testID={`plan-${plan}`}
      accessible
      accessibilityLabel={`ParkShield ${pt(`landing.${plan}Name`)}, ${price} ${t('paywallPerYear')}, ${
        available ? t('paywallAvailable') : t('paywallSoon')
      }`}
      style={[
        s.card,
        {
          backgroundColor: available ? c.bg : c.surface,
          borderColor: available ? c.primary : c.border,
          borderWidth: available ? 2 : 1,
        },
      ]}
    >
      <View style={s.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[typeScale.title, { color: c.fg }]}>{pt(`landing.${plan}Name`)}</Text>
          <Text style={[typeScale.body, { color: c.muted }]}>
            <Text style={[typeScale.heading, { color: c.fg }]}>{price}</Text> {t('paywallPerYear')}
          </Text>
        </View>
        {available ? (
          <View style={[s.pill, { backgroundColor: c.accent }]}>
            <Text style={[typeScale.caption, { color: c.accentFg, fontWeight: '800' }]}>
              {t('paywallAvailable')}
            </Text>
          </View>
        ) : (
          <Chip tone="neutral">{t('paywallSoon')}</Chip>
        )}
      </View>
      {Array.from({ length: PLAN_FEATURE_COUNTS[plan] }, (_, i) => (
        <View key={i} style={s.benefit}>
          <View style={[s.check, { backgroundColor: available ? c.infoBg : c.secondary }]}>
            <Icon name="check" size={14} color={available ? c.primary : c.muted} />
          </View>
          <Text style={[typeScale.label, { color: c.fg, fontWeight: '400', flex: 1 }]}>
            {pt(`landing.${plan}F${i + 1}` as MessageKey)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The plans as a paywall (§5.4, P7): Plus and Premium side by side with their benefits (Premium from
 * 9 Nov 2027, not bookable yet), one call to action. After the payment: the welcome moment, then
 * straight to „Auto anlegen“.
 */
export default function Plans() {
  const router = useRouter();
  return (
    <Screen>
      <Title>{t('paywallTitle')}</Title>
      <P muted>{t('paywallIntro')}</P>
      <PlanCard plan="plus" available />
      <CheckoutForm
        onPaid={() => router.replace({ pathname: '/erfolg', params: { kind: 'paid' } })}
      />
      <PlanCard plan="premium" available={false} />
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginBottom: space.xs },
  pill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  benefit: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
