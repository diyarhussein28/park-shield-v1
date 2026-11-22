import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  BlockSenderButton,
  SenderBlockedStatus,
  UnblockSenderButton,
} from '@/components/block-sender';
import { AlertTypeIcon } from '@/components/icons';
import { Banner, Button, Card, Chip, Loading, P, Screen, useTheme } from '@/components/ui';
import { radius, space, type as typeScale } from '@/theme/tokens';
import { useAlertSync } from '@/lib/alerts-store';
import { api, ApiError, authHeaders, mediaUrl } from '@/lib/api';
import { minutesSince } from '@/lib/chat';
import { lang, t } from '@/lib/i18n';
import { savePhoto } from '@/lib/photos';
import { clockTime, errorText } from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';
import type { AlertDetail } from '@/lib/types';

type Reply = 'coming' | 'in_30_min' | 'not_nearby';

/**
 * Alert detail. Opening it marks the alert "seen" (shown to the scanner) and, since 2026-11-22, counts
 * as a reaction: the reminder and the SMS are cancelled, like „Ich komme“, a reply, the chat or
 * „Erledigt“; the screen shows where the escalation stands. Photos are streamed from the API with the session (memory cache only,
 * nothing on disk) and saved to the gallery only on "Speichern".
 */
export default function AlertScreen() {
  const c = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [a, setA] = useState<AlertDetail | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<Reply | 'chat' | 'report' | 'resolve' | null>(null);
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const { senderChanged, markSeen } = useAlertSync();
  // „Missbrauch melden“: a second tap confirms, because the photos are deleted for good.
  const [confirmReport, setConfirmReport] = useState(false);
  const [reportResult, setReportResult] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );
  // Large text: the two other replies stack instead of squeezing side by side.
  const stack = useWindowDimensions().fontScale > 1.3;

  const load = useCallback(
    async (reveal = false) => {
      try {
        setA(await api<AlertDetail>(`/v1/app/alerts/${id}${reveal ? '?reveal=1' : ''}`));
        setError(false);
      } catch {
        setError(true);
      }
    },
    [id],
  );

  useEffect(() => {
    void authHeaders().then(setHeaders);
    // Opening = seen: a reaction that cancels the reminder and the SMS (2026-11-22). The badge goes
    // down at once and then takes the server's count.
    markSeen(id);
    void api<{ unseenCount?: number }>(`/v1/app/alerts/${id}/seen`, { body: {} })
      .then((r) => markSeen(id, r.unseenCount))
      .catch(() => undefined);
  }, [id, markSeen]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!a) return error ? <Banner tone="err">{t('error')}</Banner> : <Loading />;

  const reply = async (r: Reply) => {
    setBusy(r);
    try {
      await api(`/v1/app/alerts/${a.id}/ack`, { body: { reply: r } });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) setError(true);
    } finally {
      setBusy(null);
      await load(a.revealed && a.contentHidden);
    }
  };

  /**
   * „Missbrauch melden“ (alert photos §5): deletes the photos and the message at once, blocks the
   * sender for this vehicle and pauses photo uploads to it. The same endpoint as the app's history.
   */
  const reportPhotos = async () => {
    setBusy('report');
    try {
      await api(`/v1/portal/alerts/${a.id}/report-abuse`, { method: 'POST' });
      setConfirmReport(false);
      setReportResult({ tone: 'ok', text: pt('alertView.reportDone') });
    } catch (err) {
      setReportResult({ tone: 'err', text: errorText(err) });
    } finally {
      setBusy(null);
      await load();
    }
  };

  /** „Erledigt“: a stop condition like „Ich komme“, without telling the person at the vehicle anything. */
  const resolve = async () => {
    setBusy('resolve');
    try {
      await api(`/v1/app/alerts/${a.id}/resolve`, { body: {} });
    } catch {
      setError(true);
    } finally {
      setBusy(null);
      await load(a.revealed && a.contentHidden);
    }
  };

  const openChat = async () => {
    setBusy('chat');
    try {
      if (a.chat?.status === 'locked') await api(`/v1/app/alerts/${a.id}/chat/open`, { body: {} });
      router.push({ pathname: '/chat/[id]', params: { id: a.id } });
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  const type = lang() === 'en' ? a.type.en : a.type.de;
  const time = new Intl.DateTimeFormat(lang(), {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(a.createdAt));
  const resolved = a.escalation.stopReason === 'resolved';
  const done = a.reply === 'coming' || a.acknowledgedBy !== null || resolved;
  const open = !done && !['expired', 'blocked'].includes(a.status);
  const chat = a.chat;
  const lastSeen = minutesSince(chat?.scanner.lastSeenAt ?? null);
  const urgent = a.severity === 'urgent';

  // The owner's block of this sender is computed on the server (every alert of that sender says so).
  // A chat the block ended stays closed, also after „Blockierung aufheben“.
  const chatEndedByBlock = chat?.closeReason === 'blocked';
  const senderBlocked = a.senderBlocked || Boolean(chat?.senderBlocked);
  /** After block / unblock: this screen, the list, the badge and the history all refresh. */
  const afterSenderChange = async (blocked: boolean, until: string | null) => {
    await Promise.all([load(a.revealed && a.contentHidden), senderChanged(a.id, blocked, until)]);
  };
  const chatBlock = chat && !chatEndedByBlock && (
    <View style={s.chat}>
      <Text style={[typeScale.label, { color: chat.scanner.online ? c.successFg : c.muted }]}>
        {chat.scanner.online
          ? t('senderOnline')
          : lastSeen !== null
            ? t('senderOffline', { minutes: lastSeen })
            : t('senderOfflineNever')}
      </Text>
      {senderBlocked ? (
        <P muted>{t('chatBlocked')}</P>
      ) : chat.purged ? (
        <P muted>{t('chatPurged')}</P>
      ) : chat.status === 'locked' ? (
        chat.canOpen && (
          <Button
            label={t('chatOpen')}
            variant="secondary"
            onPress={() => void openChat()}
            busy={busy === 'chat'}
            testID="open-chat"
          />
        )
      ) : (
        <Button label={t('chatContinue')} variant="secondary" onPress={() => void openChat()} />
      )}
    </View>
  );

  return (
    <Screen>
      <Card style={urgent ? { borderColor: c.urgent, borderWidth: 2 } : undefined}>
        <View style={s.hero}>
          <AlertTypeIcon code={a.type.code} urgent={urgent} size={32} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text accessibilityRole="header" style={[typeScale.title, { color: c.fg }]}>
              {type}
            </Text>
            <Text style={[typeScale.label, { color: c.muted, fontWeight: '400' }]}>
              „{a.vehicle.nickname}“ · {t('at', { time })}
            </Text>
          </View>
        </View>
        <View style={s.chips}>
          {done ? (
            <Chip tone="ok">{t('acknowledged')}</Chip>
          ) : a.status === 'expired' ? (
            <Chip tone="neutral">{t('expired')}</Chip>
          ) : a.seenAt ? (
            <Chip tone="info">{t('seen')}</Chip>
          ) : (
            <Chip tone={urgent ? 'urgent' : 'info'}>{t('open')}</Chip>
          )}
          {a.isTest && <Chip tone="neutral">{t('test')}</Chip>}
        </View>
        {a.contentHidden && !a.revealed ? (
          <>
            <P>{t('hiddenContent')}</P>
            <Button label={t('reveal')} variant="secondary" onPress={() => void load(true)} />
          </>
        ) : (
          a.message && (
            <View style={[s.message, { backgroundColor: c.bg, borderColor: c.border }]}>
              <Text style={[typeScale.caption, { color: c.muted }]}>{t('message')}</Text>
              <P>{a.message}</P>
            </View>
          )
        )}
      </Card>

      {resolved && a.reply !== 'coming' ? (
        <Banner tone="ok">{t('escStop_resolved')}</Banner>
      ) : done ? (
        <Banner tone="ok">{t('comingDone')}</Banner>
      ) : a.reply === 'in_30_min' ? (
        <Banner tone="ok">{pt('reply.doneIn30')}</Banner>
      ) : a.reply === 'not_nearby' ? (
        <Banner tone="ok">{pt('reply.doneNotNearby')}</Banner>
      ) : null}

      {open && (
        <View style={s.actions}>
          <Button
            label={t('coming')}
            size="lg"
            onPress={() => void reply('coming')}
            busy={busy === 'coming'}
            testID="ack"
          />
          {chatBlock}
          <View style={[s.tertiary, stack && { flexDirection: 'column' }]}>
            <View style={s.half}>
              <Button
                label={t('in30')}
                variant="ghost"
                onPress={() => void reply('in_30_min')}
                busy={busy === 'in_30_min'}
              />
            </View>
            <View style={s.half}>
              <Button
                label={t('notNearby')}
                variant="ghost"
                onPress={() => void reply('not_nearby')}
                busy={busy === 'not_nearby'}
              />
            </View>
          </View>
          <Button
            label={t('resolve')}
            variant="secondary"
            onPress={() => void resolve()}
            busy={busy === 'resolve'}
            accessibilityHint={t('resolveHint')}
            testID="resolve"
          />
        </View>
      )}
      {a.senderBlocked && (
        <Card>
          {chatEndedByBlock && (
            <Banner tone="info" testID="blocked">
              {t('blocked')}
            </Banner>
          )}
          <SenderBlockedStatus until={a.blockedUntil} />
          <UnblockSenderButton
            alertId={a.id}
            onUnblocked={(r) => afterSenderChange(r.senderBlocked, r.blockedUntil)}
          />
        </Card>
      )}
      {/* Stage 3: not for test alerts (nobody to block); replaced by the blocked state. */}
      {!a.isTest && !a.senderBlocked && a.status !== 'blocked' && (
        <BlockSenderButton
          alertId={a.id}
          onBlocked={(r) => afterSenderChange(true, r.blockedUntil)}
        />
      )}
      <EscalationState alert={a} />
      {!open && chatBlock && <Card>{chatBlock}</Card>}

      {a.photos.map((p) => (
        <View key={p.id} style={s.photo}>
          <Image
            source={{ uri: mediaUrl(a.id, p.id), headers }}
            // Memory only: the decrypted photo never lands in a disk cache.
            cachePolicy="memory"
            accessibilityLabel={t('photoAlt', { n: p.position })}
            style={[s.image, { aspectRatio: p.width / Math.max(1, p.height) }]}
            contentFit="cover"
          />
          <Button
            label={t('savePhoto')}
            variant="secondary"
            onPress={() =>
              void savePhoto(a.id, p.id, p.position).then(
                () => setSaved(true),
                () => setError(true),
              )
            }
          />
        </View>
      ))}
      {saved && <Banner tone="ok">{t('photoSaved')}</Banner>}

      {a.photoCount > 0 &&
        (confirmReport ? (
          <Card>
            <Text accessibilityRole="header" style={[typeScale.label, { color: c.fg }]}>
              {pt('alertView.abuseTitle')}
            </Text>
            <P>{pt('alertView.abuseConfirm')}</P>
            <Button
              label={pt('alertView.abuseSend')}
              variant="danger"
              onPress={() => void reportPhotos()}
              busy={busy === 'report'}
              testID="report-abuse-confirm"
            />
            <Button
              label={pt('alertView.abuseCancel')}
              variant="ghost"
              onPress={() => setConfirmReport(false)}
            />
          </Card>
        ) : (
          <Button
            label={pt('alertView.abuseButton')}
            variant="secondary"
            onPress={() => {
              setReportResult(null);
              setConfirmReport(true);
            }}
            testID="report-abuse"
          />
        ))}
      {reportResult && <Banner tone={reportResult.tone}>{reportResult.text}</Banner>}
      {!reportResult && a.photosGone && (
        <P muted>
          {pt(a.photosGone === 'abuse_report' ? 'alertView.goneAbuse' : 'alertView.goneRetention')}
        </P>
      )}

      {error && <Banner tone="err">{t('error')}</Banner>}
    </Screen>
  );
}

/**
 * Where the owner's escalation stands (2026-11-21): reminder push after 10 min, one SMS after 30 min,
 * both cancelled once the owner reacted. Test alerts have neither planned (no card then).
 */
function EscalationState({ alert: a }: { alert: AlertDetail }) {
  const c = useTheme();
  const e = a.escalation;
  const lines: string[] = [];
  if (e.remindedAt) lines.push(t('escReminderSent', { time: clockTime(e.remindedAt) }));
  if (e.smsSentAt) lines.push(t('escSmsSent', { time: clockTime(e.smsSentAt) }));
  if (e.stoppedAt) {
    lines.push(
      e.stopReason ? `${t('escStopped')} ${t(`escStop_${e.stopReason}`)}` : t('escStopped'),
    );
  } else if (!['expired', 'blocked'].includes(a.status)) {
    if (e.reminderAt && e.smsDueAt && !e.remindedAt)
      lines.push(
        t('escPlanned', { reminder: clockTime(e.reminderAt), sms: clockTime(e.smsDueAt) }),
      );
    else if (e.smsDueAt && !e.smsSentAt)
      lines.push(t('escPlannedSms', { sms: clockTime(e.smsDueAt) }));
  }
  if (!lines.length) return null;
  return (
    <Card>
      <View testID="escalation" style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[typeScale.label, { color: c.fg }]}>
          {t('escTitle')}
        </Text>
        {lines.map((l) => (
          <P key={l} muted>
            {l}
          </P>
        ))}
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  hero: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  message: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 2 },
  actions: { gap: space.md },
  chat: { gap: space.sm },
  tertiary: { flexDirection: 'row', gap: space.sm },
  half: { flex: 1 },
  photo: { gap: 6 },
  image: { width: '100%', borderRadius: radius.lg },
});
