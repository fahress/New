import type { NextConfig } from 'next';

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : 'vwprdpizbxjokwmnotgl.supabase.co';

const nextConfig: NextConfig = {
  // native image library, used on the server only (image checks for the agent)
  serverExternalPackages: ['sharp'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: supabaseHost, pathname: '/storage/v1/object/public/**' }],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  async redirects() {
    return [
      { source: '/search', destination: '/fonts', permanent: true },
      // addresses from the previous fahress.com
      { source: '/auth/:path*', destination: '/account', permanent: true },
      { source: '/login', destination: '/account', permanent: true },
      { source: '/register', destination: '/account', permanent: true },
      { source: '/terms', destination: '/privacy', permanent: false },
    ];
  },
};

export default nextConfig;
