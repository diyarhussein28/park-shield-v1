import { HelpIndex } from './help-index';
import { createTranslator } from '@parkshield/i18n';
import { requestLocale } from '@/lib/locale';

export async function generateMetadata() {
  const t = createTranslator(await requestLocale());
  return { title: t('meta.help'), description: t('meta.helpDescription') };
}

export default function HelpPage() {
  return <HelpIndex />;
}
