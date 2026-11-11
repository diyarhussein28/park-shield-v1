import { notFound } from 'next/navigation';
import { articleBySlug, HELP_ARTICLES } from '@/lib/help-articles';
import { ArticleView } from './article';

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const a = articleBySlug((await params).slug);
  return a ? { title: `${a.de.title} · Hilfe`, description: a.de.summary } : {};
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!articleBySlug(slug)) notFound();
  return <ArticleView slug={slug} />;
}
