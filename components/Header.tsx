import Link from 'next/link';
import Logo from './Logo';
import NavLinks from './NavLinks';
import HeaderSearch from './HeaderSearch';

export default function Header() {
  return (
    <header className="site-header">
      <div className="wrap site-header__in">
        <Link href="/" className="logo" aria-label="Fahress — home">
          <Logo width={60} />
        </Link>
        <NavLinks />
        <HeaderSearch />
      </div>
    </header>
  );
}
