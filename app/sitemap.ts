import type { MetadataRoute } from 'next';
import { getArchive } from '@/lib/data';

export const revalidate = 3600;
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://fahress.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const a = await getArchive();
  return [
    { url: `${SITE}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE}/fonts`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE}/designers`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE}/foundries`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE}/about`, changeFrequency: 'monthly', priority: 0.4 },
    ...a.fonts.map((f) => ({ url: `${SITE}/fonts/${f.slug}`, lastModified: f.createdAt || undefined, priority: 0.7 })),
    ...a.people.filter((p) => p.fontIds.length).map((p) => ({ url: `${SITE}/designers/${p.slug}`, priority: 0.7 })),
  ];
}
