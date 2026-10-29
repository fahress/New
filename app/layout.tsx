import type { Metadata, Viewport } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import './globals.css';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://fahress.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: 'Fahress — The Arabic Type Design Archive', template: '%s | Fahress' },
  description:
    'Fahress indexes Arabic typefaces by script, style and license — and credits the designers and foundries who made them, with links to buy from the source.',
  openGraph: { siteName: 'Fahress', type: 'website' },
  twitter: { card: 'summary_large_image' },
  alternates: { canonical: '/' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#ffffff' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..800&family=IBM+Plex+Mono:wght@400;500&family=Readex+Pro:wght@300..700&display=swap"
        />
      </head>
      <body>
        <a href="#main" className="sr-only">Skip to content</a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
