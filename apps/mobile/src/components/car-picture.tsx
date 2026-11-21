import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { t } from '@/lib/i18n';
import { radius, useTheme } from '@/theme/tokens';
import { CarArt } from './art';

/**
 * The owner's car: their own photo from this device (Stage 4.2), else the blue car illustration. The
 * photo's file name changes with every new photo, so the URI itself busts the image cache.
 */
export function CarPicture({
  uri,
  nickname,
  width = 260,
  protectedBadge,
}: {
  uri: string | null;
  nickname: string;
  width?: number;
  protectedBadge?: boolean;
}) {
  const c = useTheme();
  if (!uri) return <CarArt width={width} protectedBadge={protectedBadge} />;
  return (
    <View style={[s.frame, { width, borderColor: c.border, backgroundColor: c.infoBg }]}>
      <Image
        testID="car-photo"
        source={{ uri }}
        recyclingKey={uri}
        // Already a local file: no second copy in the image disk cache.
        cachePolicy="memory"
        contentFit="cover"
        style={s.image}
        accessibilityLabel={t('carPhotoAlt', { nickname })}
      />
    </View>
  );
}

const s = StyleSheet.create({
  frame: { aspectRatio: 4 / 3, borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
});
