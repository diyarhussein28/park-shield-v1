import { useState } from 'react';
import { View } from 'react-native';
import { Banner, Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import { errorText } from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';
import { printReceipt, shareReceiptPdf, type Receipt } from '@/lib/receipt';
import { space } from '@/theme/tokens';

/** „Seite drucken“ and „Als PDF sichern“ under a cancellation or withdrawal receipt (QA 2026-11-25). */
export function ReceiptActions({ receipt }: { receipt: Receipt }) {
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (what: 'print' | 'pdf') => {
    setBusy(what);
    setError(null);
    try {
      await (what === 'print' ? printReceipt(receipt) : shareReceiptPdf(receipt));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      {error && <Banner tone="err">{error}</Banner>}
      <Button
        label={pt('cancel.print')}
        onPress={() => void run('print')}
        busy={busy === 'print'}
        disabled={busy !== null}
        testID="receipt-print"
      />
      <Button
        variant="secondary"
        label={t('receiptSavePdf')}
        onPress={() => void run('pdf')}
        busy={busy === 'pdf'}
        disabled={busy !== null}
        testID="receipt-pdf"
      />
    </View>
  );
}
