'use client';
import { use } from 'react';
import PersonEditor from '@/components/dashboard/PersonEditor';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PersonEditor key={id} id={id} kind="designer" />;
}
