import { Linking } from 'react-native';
import { Button, P, Screen, Title } from '@/components/ui';
import { API_URL } from '@/lib/config';
import { t } from '@/lib/i18n';

export default function Help() {
  return (
    <Screen>
      <Title>{t('help')}</Title>
      <P>{t('helpText')}</P>
      <Button label={t('helpOpen')} onPress={() => void Linking.openURL(`${API_URL}/hilfe`)} />
    </Screen>
  );
}
