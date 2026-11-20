import { View } from 'react-native';
import { CarArt, ShieldArt, WindscreenArt } from './art';

export type IllustrationName = 'empty-alerts' | 'empty-vehicles' | 'decal-placement' | 'alert-sent';

/** Named illustration slots for empty states and guides (artwork in ./art). Always decorative. */
export function Illustration({ name }: { name: IllustrationName }) {
  return (
    <View
      testID={`illustration-${name}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ minHeight: 140, alignItems: 'center', justifyContent: 'center' }}
    >
      {name === 'empty-vehicles' && <CarArt width={220} />}
      {name === 'decal-placement' && <WindscreenArt width={220} />}
      {name === 'empty-alerts' && <ShieldArt size={128} />}
      {name === 'alert-sent' && <ShieldArt size={128} />}
    </View>
  );
}
