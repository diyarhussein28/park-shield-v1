import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { CarPicture } from '@/components/car-picture';
import { Banner, Button, P, Screen, Title } from '@/components/ui';
import { t } from '@/lib/i18n';
import { pickVehiclePhoto, removeVehiclePhoto, vehiclePhoto } from '@/lib/vehicle-photo';

/**
 * „Foto Ihres Autos“ (Stage 4.2): pick a photo from the library or remove it. The photo stays on this
 * device (document directory) and is never sent to the API; the screen says so.
 */
export default function CarPhotoScreen() {
  const { id, nickname = '' } = useLocalSearchParams<{ id: string; nickname?: string }>();
  const [uri, setUri] = useState<string | null>(() => vehiclePhoto(id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const pick = async () => {
    setBusy(true);
    setError(false);
    try {
      const next = await pickVehiclePhoto(id);
      if (next) setUri(next);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{t('carPhotoTitle')}</Title>
      <CarPicture uri={uri} nickname={nickname} />
      <P muted>{t('carPhotoNote')}</P>
      <Button
        label={uri ? t('carPhotoChange') : t('carPhotoPick')}
        busy={busy}
        onPress={() => void pick()}
        testID="photo-pick"
      />
      {uri && (
        <Button
          label={t('carPhotoRemove')}
          variant="secondary"
          onPress={() => {
            removeVehiclePhoto(id);
            setUri(null);
          }}
          testID="photo-remove"
        />
      )}
      {error && <Banner tone="err">{t('carPhotoFailed')}</Banner>}
    </Screen>
  );
}
