import Link from 'next/link';
import Logo from './Logo';
import NavLinks from './NavLinks';

export default function Header() {
  return (
    <header className="site-header">
      <div className="wrap site-header__in">
        <Link href="/" className="logo" aria-label="Fahress — home">
          <Logo width={60} />
        </Link>
        <NavLinks />
        <form action="/fonts" method="get" role="search" className="header-search">
          <label htmlFor="hs" className="sr-only">Search the archive</label>
          <input id="hs" name="q" type="search" placeholder="Search fonts, designers…" autoComplete="off" />
          <button type="submit">Search</button>
        </form>
      </div>
    </header>
  );
}
