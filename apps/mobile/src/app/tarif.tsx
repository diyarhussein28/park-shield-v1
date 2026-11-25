import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { StepProgress } from '@/components/list';
import { CheckoutForm, PlanFeatures, usePlanPrice } from '@/components/subscription';
import { P, Screen, Title } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useOptionalProfile } from '@/lib/profile';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';
import { SIGNUP_STEPS } from './registrieren';

/** The one plan (owner decision 2026-11-21, price 2026-11-25): 19,99 € a year incl. VAT, everything included. */
function PlanCard() {
  const c = useTheme();
  const price = usePlanPrice();
  return (
    <View
      testID="plan-card"
      style={[s.card, { backgroundColor: c.surface, borderColor: c.primary }]}
    >
      <View
        accessible
        accessibilityLabel={`${t('planName')}, ${t('planPriceLine', { price })}`}
        style={{ gap: 2 }}
      >
        <Text style={[typeScale.title, { color: c.fg }]}>{t('planName')}</Text>
        <Text style={[typeScale.body, { color: c.muted }]}>
          <Text style={[typeScale.heading, { color: c.fg }]}>{price}</Text> {t('paywallPerYear')}
        </Text>
      </View>
      <Text style={[typeScale.label, { color: c.fg }]}>{t('planIncludes')}</Text>
      <PlanFeatures />
    </View>
  );
}

/**
 * The paywall (§5.4, P7), last step of the sign-up: a summary of the one plan with everything it
 * includes, then the § 312j checkout („Zahlungspflichtig bestellen – 19,99 € / Jahr“) with the
 * immediate-start declaration. No plan choice, no upgrade. After the payment: the welcome moment, then
 * straight to „Auto anlegen“.
 */
export default function Plans() {
  const router = useRouter();
  const newAccount = useOptionalProfile()?.newAccount ?? false;
  return (
    <Screen>
      {newAccount && (
        <StepProgress
          step={SIGNUP_STEPS}
          total={SIGNUP_STEPS}
          label={t('signUpStep', { step: SIGNUP_STEPS, total: SIGNUP_STEPS })}
        />
      )}
      <Title>{t('paywallTitle')}</Title>
      <P muted>{t('paywallIntro')}</P>
      <PlanCard />
      <CheckoutForm
        onPaid={() => router.replace({ pathname: '/erfolg', params: { kind: 'paid' } })}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 2, padding: space.lg, gap: space.md },
});
