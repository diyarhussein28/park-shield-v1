import { createTranslator } from '@parkshield/i18n';
import { notFound } from 'next/navigation';
import { requestLocale } from '@/lib/locale';
import { articleBySlug, HELP_ARTICLES } from '@/lib/help-articles';
import { ArticleView } from './article';

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const a = articleBySlug((await params).slug);
  if (!a) return {};
  const locale = await requestLocale();
  const text = a[locale];
  return {
    title: createTranslator(locale)('meta.helpArticle', { title: text.title }),
    description: text.summary,
  };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!articleBySlug(slug)) notFound();
  return <ArticleView slug={slug} />;
}
