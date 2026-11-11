'use client';

import { CUSTOM_MESSAGE_MAX } from '@parkshield/shared';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Container,
  Field,
  Heading,
  Input,
  LanguageSwitch,
  Notice,
  SkipLink,
  Stack,
  Text,
  Textarea,
  useI18n,
} from '@parkshield/ui';
import { useState } from 'react';

export function DesignSystem() {
  const { t } = useI18n();
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const emailInvalid = email.length > 0 && !email.includes('@');

  return (
    <>
      <SkipLink>{t('common.skipToContent')}</SkipLink>
      <header className="border-b border-border">
        <Container className="flex items-center justify-between py-4">
          <span className="text-lg font-bold">{t('common.appName')}</span>
          <LanguageSwitch />
        </Container>
      </header>
      <main id="main">
        <Container className="py-8">
          <Stack gap={8}>
            <Stack gap={2}>
              <Heading level={1}>{t('design.title')}</Heading>
              <Text muted>{t('design.intro')}</Text>
            </Stack>

            <Card>
              <Stack gap={4}>
                <Heading level={2}>{t('design.buttons')}</Heading>
                <div className="flex flex-wrap gap-3">
                  <Button>{t('design.primary')}</Button>
                  <Button variant="secondary">{t('design.secondary')}</Button>
                  <Button variant="danger">{t('design.danger')}</Button>
                  <Button variant="ghost">{t('design.ghost')}</Button>
                  <Button busy>{t('common.loading')}</Button>
                </div>
                <Button size="lg" block>
                  {t('design.sampleAlert')}
                </Button>
              </Stack>
            </Card>

            <Card>
              <Stack gap={4}>
                <Heading level={2}>{t('design.badges')}</Heading>
                <div className="flex flex-wrap gap-2">
                  <Badge>{t('design.vehicles', { count: 2 })}</Badge>
                  <Badge tone="info">{t('design.statusSent')}</Badge>
                  <Badge tone="success">{t('design.statusConfirmed')}</Badge>
                  <Badge tone="warning">{t('design.statusEscalated')}</Badge>
                  <Badge tone="danger">{t('design.statusExpired')}</Badge>
                </div>
              </Stack>
            </Card>

            <Card>
              <Stack gap={3}>
                <Heading level={2}>{t('design.notices')}</Heading>
                <Notice tone="info">{t('design.noticeInfo')}</Notice>
                <Notice tone="success">{t('design.noticeSuccess')}</Notice>
                <Notice tone="warning">{t('design.noticeWarning')}</Notice>
                <Notice tone="danger">{t('design.noticeDanger')}</Notice>
              </Stack>
            </Card>

            <Card>
              <Stack gap={4}>
                <Heading level={2}>{t('design.form')}</Heading>
                <Field
                  label={t('design.emailLabel')}
                  hint={t('design.emailHint')}
                  error={emailInvalid ? t('design.emailInvalid') : undefined}
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                    />
                  )}
                </Field>
                <Field
                  label={t('design.messageLabel')}
                  optionalLabel={t('common.optional')}
                  hint={t('design.messageCount', {
                    count: message.length,
                    max: CUSTOM_MESSAGE_MAX,
                  })}
                >
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      maxLength={CUSTOM_MESSAGE_MAX}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      aria-describedby={describedBy}
                    />
                  )}
                </Field>
                <Checkbox label={t('design.immediateStart')} />
              </Stack>
            </Card>
          </Stack>
        </Container>
      </main>
    </>
  );
}
