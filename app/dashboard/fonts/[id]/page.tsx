'use client';
import { use } from 'react';
import FontEditor from '@/components/dashboard/FontEditor';

export default function EditFont({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <FontEditor key={id} id={id} />;
}
