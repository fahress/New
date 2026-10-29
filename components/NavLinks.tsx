'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/fonts', label: 'Catalog' },
  { href: '/designers', label: 'Designers' },
  { href: '/foundries', label: 'Foundries' },
  { href: '/about', label: 'About' },
];

export default function NavLinks() {
  const path = usePathname() ?? '/';
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => {
        const active = path === l.href || path.startsWith(l.href + '/');
        return (
          <Link key={l.href} href={l.href} className="ul" aria-current={active ? 'page' : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
