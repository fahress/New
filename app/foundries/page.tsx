import type { Metadata } from 'next';
import { DirectoryPage } from '@/lib/directory';

export const revalidate = 600;
export const metadata: Metadata = {
  title: 'Foundries — studios publishing Arabic type',
  description: 'Type foundries that publish Arabic typefaces, indexed on Fahress with the designers who work with them.',
  alternates: { canonical: '/foundries' },
};

export default function Page() {
  return <DirectoryPage kind="foundry" />;
}
