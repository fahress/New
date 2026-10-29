import type { Metadata } from 'next';
import { PersonPage, personMetadata, personParams } from '@/lib/person-page';

export const revalidate = 600;
export const dynamicParams = true;

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return personParams('designer');
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return personMetadata((await params).slug);
}

export default async function Page({ params }: Props) {
  return <PersonPage slug={(await params).slug} kind="designer" />;
}
