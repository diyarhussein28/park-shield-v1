import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '@/theme/tokens';

export type IllustrationName = 'empty-alerts' | 'empty-vehicles' | 'decal-placement' | 'alert-sent';

/**
 * Illustration slots. Until real artwork exists (it goes to assets/illustrations/<name>.svg), each slot
 * draws a calm placeholder from brand shapes: the shield, a QR square and a car outline. Always
 * decorative: the title and text next to it carry the meaning.
 */
export function Illustration({ name }: { name: IllustrationName }) {
  const c = useTheme();
  const shield = 'M16 2 4 6.5v8.6C4 22.4 9.1 28.2 16 30c6.9-1.8 12-7.6 12-14.9V6.5L16 2Z';
  const car = 'M30 92h100l-10-26c-2-6-8-10-14-10H54c-6 0-12 4-14 10L30 92Zm-6 0h112v20H24z';
  return (
    <View
      testID={`illustration-${name}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 160, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={200} height={150} viewBox="0 0 160 120">
        <Circle cx="80" cy="60" r="56" fill={c.infoBg} />
        {(name === 'empty-vehicles' || name === 'decal-placement') && (
          <Path d={car} fill="none" stroke={c.primary} strokeWidth={4} strokeLinejoin="round" />
        )}
        {name === 'decal-placement' && (
          <Rect x="92" y="62" width="14" height="14" rx="3" fill={c.brandYellow} />
        )}
        {(name === 'empty-alerts' || name === 'alert-sent') && (
          <Path d={shield} transform="translate(44 22) scale(2.25)" fill={c.primary} />
        )}
        {name === 'empty-alerts' && (
          <Rect x="70" y="50" width="20" height="20" rx="4" fill={c.brandYellow} />
        )}
        {name === 'alert-sent' && (
          <Path
            d="M66 60l10 10 20-22"
            fill="none"
            stroke="#ffffff"
            strokeWidth={6}
            strokeLinecap="round"
          />
        )}
      </Svg>
    </View>
  );
}
