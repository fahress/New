import Link from 'next/link';
import Logo from './Logo';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap site-footer__in">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Logo width={120} />
          <span className="mono" style={{ color: 'var(--mute-inv)' }}>The Arabic Type Design Archive</span>
        </div>
        <nav aria-label="Footer">
          <Link href="/fonts" className="ul">Catalog</Link>
          <Link href="/about" className="ul">About</Link>
          <Link href="/designers" className="ul">Designers</Link>
          <Link href="/submit" className="ul">Submit a font</Link>
          <Link href="/account" className="ul">Designer account</Link>
          <Link href="/foundries" className="ul">Foundries</Link>
          <a href="https://www.instagram.com/fahresstype" className="ul" target="_blank" rel="noopener">Instagram ↗</a>
        </nav>
      </div>
      <div className="wrap site-footer__base">
        <span className="mono">© Fahress</span>
        <span className="mono" style={{ textTransform: 'none' }}>admin@fahress.com</span>
      </div>
    </footer>
  );
}
