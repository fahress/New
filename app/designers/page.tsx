import type { Metadata } from 'next';
import { DirectoryPage } from '@/lib/directory';

export const dynamic = 'force-dynamic'; // a fresh random order on every visit
export const metadata: Metadata = {
  title: 'Designers — the people behind Arabic typefaces',
  description: 'Every Arabic type designer credited on Fahress, with their typefaces, story and links.',
  alternates: { canonical: '/designers' },
};

export default function Page() {
  return <DirectoryPage kind="designer" />;
}
