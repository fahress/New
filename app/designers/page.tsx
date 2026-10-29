import type { Metadata } from 'next';
import { DirectoryPage } from '@/lib/directory';

export const revalidate = 600;
export const metadata: Metadata = {
  title: 'Designers — the people behind Arabic typefaces',
  description: 'Every Arabic type designer credited on Fahress, with their typefaces, story and links.',
  alternates: { canonical: '/designers' },
};

export default function Page() {
  return <DirectoryPage kind="designer" />;
}
