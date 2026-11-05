'use client';
import { useEffect, useRef } from 'react';
import { useToast } from './ui';

/**
 * "Add to Fahress" bookmark: runs on the store page in the editor's own browser, so it works on sites that block
 * the dashboard's server (Payhip and other stores behind bot filters). It opens a new font pre-filled with the page's
 * name, description, link and images.
 */
export function bookmarkletCode(origin: string) {
  const js = `(()=>{const m=n=>(document.querySelector('meta[property="'+n+'"],meta[name="'+n+'"]')||{}).content||'';`
    // Payhip/Cloudflare wrap images as /cdn-cgi/image/<opts>/<original url>: keep the original, which can be downloaded
    + `const un=u=>{const i=u.indexOf('/cdn-cgi/image/');if(i<0)return u;const j=u.indexOf('/http',i+15);return j>0?u.slice(j+1):u};`
    + `let im=[m('og:image'),...[...document.images].filter(i=>(i.naturalWidth||0)>=400).map(i=>i.currentSrc||i.src)].filter(u=>/^https?:/.test(u)).map(un);`
    + `im=[...new Set(im)].slice(0,20);`
    + `const t=(m('og:title')||document.title).replace(/\\s*[|–—-]\\s*(Payhip|Gumroad|Etsy|Creative Market|Envato.*|Fontspring|MyFonts)\\s*$/i,'').replace(/\\s*[-–]\\s*(arabic\\s+)?(font|typeface)s?\\s*$/i,'').trim();`
    + `const d=(m('og:description')||m('description')).trim().slice(0,1500);`
    + `const p={name:t,description:d,images:im,links:[location.href],source:location.href,auto:1};`
    + `const s=btoa(unescape(encodeURIComponent(JSON.stringify(p)))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');`
    + `window.open('${origin}/dashboard/fonts/new?from='+s,'_blank')})()`;
  return `javascript:${encodeURIComponent(js)}`;
}

export default function Bookmarklet() {
  const a = useRef<HTMLAnchorElement>(null);
  const toast = useToast();
  // React refuses javascript: links in JSX, so the address is set directly on the element
  useEffect(() => { a.current?.setAttribute('href', bookmarkletCode(window.location.origin)); }, []);
  return (
    <a
      ref={a}
      className="dz-btn dz-btn--sm"
      draggable
      onClick={(e) => { e.preventDefault(); toast('Drag this button to your browser’s bookmarks bar. Then, on a store page (e.g. Payhip), click the bookmark.'); }}
      title="Drag me to your bookmarks bar"
      style={{ cursor: 'grab' }}
    >
      ＋ Add to Fahress
    </a>
  );
}
