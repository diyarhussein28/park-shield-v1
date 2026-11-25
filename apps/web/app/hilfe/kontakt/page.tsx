import { ContactForm } from './contact-form';
import { pageMetadata } from '@/lib/meta';

export const generateMetadata = () => pageMetadata('meta.helpContact');

export default function ContactPage() {
  return <ContactForm />;
}
