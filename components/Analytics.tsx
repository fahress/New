'use client';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** Google Analytics 4 — property "Fahress web" (admin@fahress.com). Public site only. */
export const GA_ID = 'G-H5RM7WHFLS';

type Gtag = (...args: unknown[]) => void;
const gtag: Gtag = (...args) => {
  const w = window as unknown as { gtag?: Gtag; dataLayer?: unknown[] };
  if (w.gtag) w.gtag(...args);
  else (w.dataLayer ??= []).push(args);
};

/** Records what someone searched for (shows under "search_term" in Analytics). */
export function trackSearch(term: string, where: string) {
  const t = term.trim();
  if (t.length < 2 || typeof window === 'undefined') return;
  gtag('event', 'search', { search_term: t.slice(0, 100), search_location: where });
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
/** For search boxes that update as you type: records the term once typing pauses. */
export function trackSearchSoon(term: string, where: string) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => trackSearch(term, where), 1500);
}

/** Loads Analytics and sends one page view per page (not one per keystroke in search boxes). */
export default function Analytics() {
  const path = usePathname();
  useEffect(() => {
    if (path.startsWith('/dashboard')) return;
    const t = setTimeout(() => {
      gtag('event', 'page_view', { page_location: window.location.href, page_path: path, page_title: document.title });
    }, 600); // let the title and address settle
    return () => clearTimeout(t);
  }, [path]);

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${GA_ID}',{send_page_view:false});`}
      </Script>
    </>
  );
}
