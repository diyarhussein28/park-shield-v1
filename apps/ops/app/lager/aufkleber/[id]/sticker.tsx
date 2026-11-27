'use client';

import type { MessageKey } from '@parkshield/i18n';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Notice,
  Stack,
  Text,
  useI18n,
} from '@parkshield/ui';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { OpsShell, Section } from '@/components/ops-shell';
import { opsApi } from '@/lib/api';
import { errorCode, fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';

export interface StickerData {
  sticker: {
    id: string;
    serial: string;
    status: 'in_stock' | 'assigned' | 'revoked';
    revokeReason: string | null;
    batchId: string;
    chip: string | null;
    method: 'web_nfc' | 'nfc_tools' | null;
    writtenAt: string | null;
    verifiedAt: string | null;
    lockedAt: string | null;
    ready: boolean;
  };
}
interface Target {
  url: string;
  ndefPayloadHex: string;
  qrSvg: string;
}

/** The parts of Web NFC (Chrome on Android only) this page uses. */
interface NdefRecord {
  recordType: string;
  data?: DataView;
}
interface NdefReadingEvent extends Event {
  serialNumber: string;
  message: { records: NdefRecord[] };
}
interface NdefReader extends EventTarget {
  write(
    message: { records: { recordType: 'url'; data: string }[] },
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  makeReadOnly(options?: { signal?: AbortSignal }): Promise<void>;
}
type NdefReaderCtor = new () => NdefReader;
const noSubscribe = () => () => {};
const ndefReader = (): NdefReaderCtor | null =>
  typeof window !== 'undefined' && 'NDEFReader' in window
    ? (window as unknown as { NDEFReader: NdefReaderCtor }).NDEFReader
    : null;

/** Waits for the next tap and returns the chip's first URL record and its UID. */
function readOnce(Reader: NdefReaderCtor, signal: AbortSignal) {
  return new Promise<{ url: string; uid: string }>((resolve, reject) => {
    const r = new Reader();
    r.addEventListener('reading', (e) => {
      const ev = e as NdefReadingEvent;
      const rec = ev.message.records.find((x) => x.recordType === 'url');
      const url = rec?.data ? new TextDecoder().decode(rec.data) : '';
      resolve({ url, uid: ev.serialNumber ?? '' });
    });
    r.addEventListener('readingerror', () => reject(new Error('read')));
    r.scan({ signal }).catch(reject);
  });
}

type Msg = { tone: 'success' | 'danger' | 'info'; text: string } | null;

const ERRORS: Record<string, MessageKey> = {
  nfc_mismatch: 'opsSticker.errMismatch',
  nfc_other_chip: 'opsSticker.errOtherChip',
  nfc_uid_in_use: 'opsSticker.errUidInUse',
  nfc_locked: 'opsSticker.errLocked',
  nfc_not_written: 'opsSticker.errNotWritten',
  nfc_not_verified: 'opsSticker.errNotVerified',
  not_in_stock: 'opsSticker.errNotInStock',
};

/**
 * Phase 2 of the NFC stickers: write the sticker's URL onto its chip, read it back and compare, then
 * lock the chip for good after an explicit confirmation. Web NFC works only in Chrome on Android; on
 * other devices staff use the NFC Tools app and paste what it read.
 */
export function StickerDetail({
  me,
  id,
  initial,
}: {
  me: StaffMe;
  id: string;
  initial: StickerData | null;
}) {
  const { t, locale } = useI18n();
  const [data, setData] = useState(initial);
  const [target, setTarget] = useState<Target | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  // Web NFC is a browser feature: false on the server, the real answer after hydration.
  const webNfc = useSyncExternalStore(
    noSubscribe,
    () => ndefReader() !== null,
    () => false,
  );
  const [pasted, setPasted] = useState('');
  const [pastedUid, setPastedUid] = useState('');
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  if (!data)
    return (
      <OpsShell me={me}>
        <Notice tone="danger">{t('ops.forbidden')}</Notice>
      </OpsShell>
    );
  const s = data.sticker;
  const workable = s.status === 'in_stock' && !s.lockedAt;

  async function call(path: string, body: unknown, ok: MessageKey) {
    const res = await opsApi<StickerData>(`/ops/v1/stickers/${id}${path}`, { body });
    setData(res);
    setMsg({ tone: 'success', text: t(ok) });
    return res;
  }
  async function step(fn: () => Promise<unknown>) {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      const code = errorCode(err);
      const nfc = err instanceof Error && !code;
      setMsg({
        tone: 'danger',
        text:
          code && ERRORS[code] ? t(ERRORS[code]) : nfc ? t('opsSticker.errNfc') : t('ops.error'),
      });
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }
  const showTarget = () =>
    step(async () => setTarget(await opsApi<Target>(`/ops/v1/stickers/${id}/nfc`)));
  const tap = () => {
    abort.current?.abort();
    abort.current = new AbortController();
    setTimeout(() => abort.current?.abort(), 30_000);
    return abort.current.signal;
  };

  async function writeWeb() {
    const Reader = ndefReader();
    if (!Reader || !target) return;
    await step(async () => {
      setMsg({ tone: 'info', text: t('opsSticker.holdToWrite') });
      await new Reader().write(
        { records: [{ recordType: 'url', data: target.url }] },
        {
          signal: tap(),
        },
      );
      await call('/nfc/written', { method: 'web_nfc' }, 'opsSticker.written');
    });
  }
  async function verifyWeb() {
    const Reader = ndefReader();
    if (!Reader) return;
    await step(async () => {
      setMsg({ tone: 'info', text: t('opsSticker.holdToRead') });
      const read = await readOnce(Reader, tap());
      await call(
        '/nfc/verify',
        { readUrl: read.url, uid: read.uid || undefined },
        'opsSticker.verified',
      );
    });
  }
  async function lockWeb() {
    const Reader = ndefReader();
    if (!Reader) return;
    await step(async () => {
      setMsg({ tone: 'info', text: t('opsSticker.holdToLock') });
      await new Reader().makeReadOnly({ signal: tap() });
      await call('/nfc/locked', { confirmIrreversible: true }, 'opsSticker.locked');
      setSure(false);
    });
  }

  const state = (at: string | null, label: MessageKey) => (
    <li className="flex flex-wrap items-center gap-2">
      <Badge tone={at ? 'success' : 'neutral'}>
        {at ? t('opsSticker.done') : t('opsSticker.open')}
      </Badge>
      <span>{t(label)}</span>
      {at && <span className="text-sm text-muted">{fmt(at, locale)}</span>}
    </li>
  );

  return (
    <OpsShell
      me={me}
      title={t('opsSticker.title', { serial: s.serial })}
      intro={t('opsSticker.intro')}
      back={{ href: '/lager', label: t('opsSticker.back') }}
    >
      <Stack gap={6}>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        <Section title={t('opsSticker.stateTitle')} icon="list">
          <Stack gap={3}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={s.ready ? 'success' : s.status === 'revoked' ? 'danger' : 'info'}>
                {t(`opsSticker.status_${s.ready ? 'ready' : s.status}` as MessageKey)}
              </Badge>
              {s.chip && <Badge>{s.chip}</Badge>}
              {s.revokeReason && (
                <span className="text-sm text-muted">
                  {t('opsSticker.reason', { reason: s.revokeReason })}
                </span>
              )}
            </div>
            <ul className="flex flex-col gap-2" aria-label={t('opsSticker.stateTitle')}>
              {state(s.writtenAt, 'opsSticker.stepWritten')}
              {state(s.verifiedAt, 'opsSticker.stepVerified')}
              {state(s.lockedAt, 'opsSticker.stepLocked')}
            </ul>
          </Stack>
        </Section>

        {workable && (
          <Section title={t('opsSticker.nfcTitle')} icon="key" intro={t('opsSticker.nfcIntro')}>
            <Stack gap={4}>
              {!target ? (
                <Button className="w-fit" disabled={busy} onClick={showTarget}>
                  {t('opsSticker.showUrl')}
                </Button>
              ) : (
                <Stack gap={3}>
                  <div className="flex flex-wrap items-start gap-4">
                    <img
                      src={`data:image/svg+xml;base64,${btoa(target.qrSvg)}`}
                      alt={t('opsSticker.qrAlt', { serial: s.serial })}
                      width={160}
                      height={160}
                      className="rounded-lg border border-border bg-white"
                    />
                    <div className="flex min-w-0 flex-col gap-2">
                      <Text className="font-mono wrap-anywhere">{target.url}</Text>
                      <Button
                        variant="secondary"
                        className="w-fit"
                        onClick={() =>
                          navigator.clipboard
                            .writeText(target.url)
                            .then(() => setMsg({ tone: 'success', text: t('opsSticker.copied') }))
                            .catch(() => setMsg({ tone: 'danger', text: t('ops.error') }))
                        }
                      >
                        {t('opsSticker.copy')}
                      </Button>
                    </div>
                  </div>

                  {webNfc ? (
                    <Stack gap={3}>
                      <Text muted>{t('opsSticker.webNfcHint')}</Text>
                      <div className="flex flex-wrap gap-3">
                        <Button disabled={busy} onClick={writeWeb}>
                          {t('opsSticker.write')}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy || !s.writtenAt}
                          onClick={verifyWeb}
                        >
                          {t('opsSticker.verify')}
                        </Button>
                      </div>
                    </Stack>
                  ) : (
                    <Stack gap={3}>
                      <Notice tone="info">{t('opsSticker.noWebNfc')}</Notice>
                      <Button
                        variant="secondary"
                        className="w-fit"
                        disabled={busy}
                        onClick={() =>
                          step(() =>
                            call('/nfc/written', { method: 'nfc_tools' }, 'opsSticker.written'),
                          )
                        }
                      >
                        {t('opsSticker.markWritten')}
                      </Button>
                      <form
                        className="grid gap-3 md:grid-cols-2"
                        aria-label={t('opsSticker.checkTitle')}
                        onSubmit={(e) => {
                          e.preventDefault();
                          void step(() =>
                            call(
                              '/nfc/verify',
                              { readUrl: pasted, uid: pastedUid || undefined },
                              'opsSticker.verified',
                            ),
                          );
                        }}
                      >
                        <Field label={t('opsSticker.readUrl')}>
                          {({ id: fid }) => (
                            <Input
                              id={fid}
                              required
                              value={pasted}
                              onChange={(e) => setPasted(e.target.value)}
                            />
                          )}
                        </Field>
                        <Field label={t('opsSticker.readUid')} optionalLabel={t('common.optional')}>
                          {({ id: fid }) => (
                            <Input
                              id={fid}
                              value={pastedUid}
                              onChange={(e) => setPastedUid(e.target.value)}
                            />
                          )}
                        </Field>
                        <Button
                          type="submit"
                          variant="secondary"
                          className="w-fit"
                          disabled={busy || !s.writtenAt}
                        >
                          {t('opsSticker.verify')}
                        </Button>
                      </form>
                    </Stack>
                  )}
                </Stack>
              )}

              {s.verifiedAt && (
                <Stack gap={3}>
                  <Notice tone="warning">{t('opsSticker.lockWarning')}</Notice>
                  <Checkbox
                    label={t('opsSticker.lockConfirm')}
                    checked={sure}
                    onChange={(e) => setSure(e.target.checked)}
                  />
                  <Button
                    className="w-fit"
                    disabled={busy || !sure}
                    onClick={() =>
                      webNfc
                        ? lockWeb()
                        : step(async () => {
                            await call(
                              '/nfc/locked',
                              { confirmIrreversible: true },
                              'opsSticker.locked',
                            );
                            setSure(false);
                          })
                    }
                  >
                    {webNfc ? t('opsSticker.lockWeb') : t('opsSticker.lockTools')}
                  </Button>
                </Stack>
              )}
            </Stack>
          </Section>
        )}

        {s.status === 'in_stock' && (
          <Section title={t('opsSticker.damagedTitle')} icon="alert">
            <form
              className="flex flex-col gap-3"
              aria-label={t('opsSticker.damagedTitle')}
              onSubmit={(e) => {
                e.preventDefault();
                void step(() => call('/damaged', { note }, 'opsSticker.damagedDone'));
              }}
            >
              <Text muted>{t('opsSticker.damagedText')}</Text>
              <Field label={t('opsSticker.damagedNote')}>
                {({ id: fid }) => (
                  <Input
                    id={fid}
                    required
                    minLength={3}
                    maxLength={200}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                )}
              </Field>
              <Button type="submit" variant="secondary" className="w-fit" disabled={busy}>
                {t('opsSticker.damaged')}
              </Button>
            </form>
          </Section>
        )}
      </Stack>
    </OpsShell>
  );
}
