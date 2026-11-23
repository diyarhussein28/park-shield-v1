import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Field } from '@/components/form';
import { Banner, Button, Card, P, Screen, Title, useTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { APP_VERSION, WEBSITE_URL } from '@/lib/config';
import { lang, t } from '@/lib/i18n';
import { errorText, openInBrowser } from '@/lib/portal';
import { useOptionalProfile } from '@/lib/profile';
import { validateContact, type ContactErrors } from '@/lib/support';

/**
 * Hilfe: the help centre and FAQ on park-shield.de (in-app browser, nothing stored on the phone) and
 * the in-app contact form. The request goes to support@park-shield.de with the customer as reply-to;
 * the form sends only what the customer types plus the app version (DSGVO Art. 5 (1) c).
 */
export default function Help() {
  const c = useTheme();
  const accountEmail = useOptionalProfile()?.data?.email ?? '';
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  // null = not edited yet: shows the account's address, also when the profile loads after the screen.
  const [typedEmail, setEmail] = useState<string | null>(null);
  const email = typedEmail ?? accountEmail;
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<ContactErrors>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [sent, setSent] = useState<{ ticket: string; email: string } | null>(null);

  const reset = () => {
    setSubject('');
    setMessage('');
    setEmail(null);
    setErrors({});
    setFailed(null);
  };

  const submit = async () => {
    const e = validateContact({ subject, email, message });
    setErrors(e);
    setFailed(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await api<{ ticket: string }>('/v1/app/support/contact', {
        body: {
          subject: subject.trim(),
          email: email.trim(),
          message: message.trim(),
          locale: lang(),
          client: `app ${APP_VERSION} ${Platform.OS}`,
        },
      });
      setSent({ ticket: r.ticket, email: email.trim().toLowerCase() });
      setOpen(false);
      reset();
    } catch (err) {
      setFailed(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{t('help')}</Title>
      <P>{t('helpText')}</P>
      <Button
        testID="help-faq"
        label={t('helpOpen')}
        onPress={() => void openInBrowser(`${WEBSITE_URL}/hilfe`)}
      />
      {!open && (
        <Button
          testID="help-contact"
          variant="secondary"
          label={t('helpContact')}
          onPress={() => {
            setSent(null);
            setOpen(true);
          }}
        />
      )}

      {sent && (
        <Banner tone="ok" testID="help-sent">
          {t('helpSent', { ticket: sent.ticket, email: sent.email })}
        </Banner>
      )}

      {open && (
        <Card style={{ gap: 4 }}>
          <Text
            accessibilityRole="header"
            style={{ color: c.fg, fontSize: 20, fontWeight: '700', marginBottom: 4 }}
          >
            {t('helpContactTitle')}
          </Text>
          <P muted>{t('helpContactIntro')}</P>
          <Field
            testID="help-subject"
            label={t('helpSubject')}
            value={subject}
            onChangeText={setSubject}
            maxLength={120}
            error={errors.subject}
            returnKeyType="next"
          />
          <Field
            testID="help-email"
            label={t('helpReplyEmail')}
            hint={t('helpReplyEmailHint')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={254}
            error={errors.email}
          />
          <Field
            testID="help-message"
            label={t('helpMessage')}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={6}
            maxLength={5000}
            textAlignVertical="top"
            error={errors.message}
          />
          {failed && (
            <Banner tone="err" testID="help-error">
              {failed}
            </Banner>
          )}
          <View style={{ gap: 8, marginTop: 4 }}>
            <Button
              testID="help-send"
              label={t('helpSend')}
              busy={busy}
              onPress={() => void submit()}
            />
            <Button
              variant="ghost"
              label={t('helpCancel')}
              disabled={busy}
              onPress={() => {
                setOpen(false);
                reset();
              }}
            />
          </View>
          <P muted style={{ fontSize: 14, marginTop: 4 }}>
            {t('helpPrivacy')}
          </P>
          <Pressable
            accessibilityRole="link"
            hitSlop={8}
            onPress={() => void openInBrowser(`${WEBSITE_URL}/datenschutz`)}
          >
            <Text style={{ color: c.primary, fontSize: 15, textDecorationLine: 'underline' }}>
              {t('helpPrivacyLink')}
            </Text>
          </Pressable>
        </Card>
      )}
    </Screen>
  );
}
