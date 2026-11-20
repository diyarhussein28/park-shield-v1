import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Badge, Choice, Field, H3 } from '@/components/form';
import { Banner, Button, Card, P, useTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { lang } from '@/lib/i18n';
import { errorText, openInBrowser, type HistoryAlert } from '@/lib/portal';
import { pt, type MessageKey } from '@/lib/portal-i18n';

const REASONS = ['harassment', 'spam', 'false_alarm', 'other'] as const;

/**
 * OW-08 / US-31 (web: /konto/verlauf): the last 90 days, muted alerts included, with blocking. Shown
 * in the Warnungen tab under „Verlauf (90 Tage)“.
 */
export function HistoryList() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<HistoryAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void api<{ alerts: HistoryAlert[] }>('/v1/alerts')
        .then((r) => setAlerts(r.alerts))
        .catch((err) => setError(errorText(err)));
    }, []),
  );

  return (
    <View style={hs.list}>
      <P muted>{pt('history.intro')}</P>
      <Button
        label={pt('deliveryHelp.link')}
        variant="secondary"
        onPress={() => router.push('/zustellung')}
      />
      {error && <Banner tone="err">{error}</Banner>}
      {alerts?.length === 0 && <P>{pt('history.none')}</P>}
      {alerts?.map((a) => (
        <AlertCard
          key={a.id}
          alert={a}
          onReported={() =>
            setAlerts(
              (list) => list?.map((x) => (x.id === a.id ? { ...x, reported: true } : x)) ?? null,
            )
          }
        />
      ))}
    </View>
  );
}

const hs = StyleSheet.create({ list: { gap: 12 } });

function AlertCard({ alert: a, onReported }: { alert: HistoryAlert; onReported: () => void }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>('harassment');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [hidden, setHidden] = useState<{ message: string | null } | null>(null);
  const [showing, setShowing] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoCount, setPhotoCount] = useState(a.photos?.count ?? 0);

  /** „Missbrauch melden“ for an alert with photos deletes them at once (alert photos §5). */
  const reportPhotos = async () => {
    setPhotoBusy(true);
    try {
      await api(`/v1/portal/alerts/${a.id}/report-abuse`, { method: 'POST' });
      setPhotoCount(0);
      setResult({ tone: 'ok', text: pt('alertView.reportDone') });
      onReported();
    } catch (err) {
      setResult({ tone: 'err', text: errorText(err) });
    } finally {
      setPhotoBusy(false);
    }
  };

  /** Protected Mode: the owner opens hidden content explicitly („Anzeigen“). */
  const show = async () => {
    setShowing(true);
    try {
      setHidden(await api<{ message: string | null }>(`/v1/alerts/${a.id}/hidden-content`));
    } catch (err) {
      setResult({ tone: 'err', text: errorText(err) });
    } finally {
      setShowing(false);
    }
  };

  const report = async () => {
    setBusy(true);
    try {
      const r = await api<{ blocked: boolean; phoneBanned: boolean; protectedMode: boolean }>(
        `/v1/alerts/${a.id}/report`,
        {
          body: { reason, note: note.trim() || undefined },
        },
      );
      const nickname = a.vehicle.nickname;
      const lines = [
        r.phoneBanned
          ? pt('history.reportedPhone', { nickname })
          : r.blocked
            ? pt('history.reportedBlocked', { nickname })
            : pt('history.reportedOnly'),
      ];
      if (r.protectedMode) lines.push(pt('history.protectedOn', { nickname }));
      setResult({ tone: 'ok', text: lines.join(' ') });
      setOpen(false);
      onReported();
    } catch (err) {
      setResult({ tone: 'err', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <H3>
        {lang() === 'en' ? a.type.en : a.type.de} · „{a.vehicle.nickname}“
      </H3>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {a.isTest && <Badge>{pt('history.test')}</Badge>}
        {a.severity === 'urgent' && !a.isTest && <Badge tone="warn">!</Badge>}
        {a.verifiedSender && <Badge>{pt('history.verifiedSender')}</Badge>}
      </View>
      <P muted>{pt('history.at', { date: new Date(a.createdAt) })}</P>
      <P style={{ fontWeight: '700' }}>
        {a.muted ? pt(`history.muted_${a.muted}`) : pt(`history.status_${a.status}` as MessageKey)}
        {a.ownerReply ? ` · ${pt(`history.reply_${a.ownerReply}`)}` : ''}
      </P>
      {a.message && <P>{pt('history.message', { message: a.message })}</P>}
      {a.hiddenContent &&
        (hidden?.message ? (
          <P>{pt('history.message', { message: hidden.message })}</P>
        ) : (
          <View
            style={{ gap: 6, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 10 }}
          >
            <P muted>{pt('history.hiddenHint')}</P>
            <Button
              label={pt('history.hiddenShow')}
              variant="secondary"
              busy={showing}
              onPress={() => void show()}
            />
          </View>
        ))}
      {photoCount > 0 && (
        <View
          style={{ gap: 6, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 10 }}
        >
          <P>{pt('history.photos', { count: photoCount })}</P>
          {a.photos?.viewPath && (
            <Button
              label={pt('history.photosView')}
              variant="secondary"
              onPress={() => void openInBrowser(a.photos!.viewPath!)}
            />
          )}
          <Button
            label={pt('alertView.abuseSend')}
            variant="danger"
            busy={photoBusy}
            onPress={() => void reportPhotos()}
          />
        </View>
      )}
      {a.deliveries.length > 0 && (
        <P muted>
          {pt('history.channels')}:{' '}
          {a.deliveries
            .map(
              (d) =>
                `${pt('channels.channelName', { channel: d.channel })} (${pt(`deliveryHelp.s_${d.status}` as MessageKey)})`,
            )
            .join(', ')}
        </P>
      )}
      {result && <Banner tone={result.tone}>{result.text}</Banner>}
      {!a.isTest &&
        (a.reported ? (
          !result && <Badge>{pt('history.reported')}</Badge>
        ) : open ? (
          <View style={{ gap: 10 }}>
            <H3>{pt('history.reportTitle')}</H3>
            {!a.canBlock && <P muted>{pt('history.reportOld')}</P>}
            <Choice
              legend={pt('history.reportReason')}
              options={REASONS}
              value={reason}
              onChange={setReason}
              label={(r) => pt(`history.reason_${r}`)}
            />
            <Field
              label={pt('history.reportNote')}
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={500}
            />
            <Button
              label={pt('history.reportSend')}
              variant="danger"
              busy={busy}
              onPress={() => void report()}
            />
            <Button
              label={pt('history.reportCancel')}
              variant="secondary"
              onPress={() => setOpen(false)}
            />
          </View>
        ) : (
          <Button label={pt('history.report')} variant="secondary" onPress={() => setOpen(true)} />
        ))}
    </Card>
  );
}
