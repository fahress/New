import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://fahress.com';

export default function robots(): MetadataRoute.Robots {
  // Preview deployments should never be indexed; only the production domain is.
  const isProd = process.env.VERCEL_ENV ? process.env.VERCEL_ENV === 'production' : true;
  return isProd
    ? { rules: { userAgent: '*', allow: '/' }, sitemap: `${SITE}/sitemap.xml` }
    : { rules: { userAgent: '*', disallow: '/' } };
}
