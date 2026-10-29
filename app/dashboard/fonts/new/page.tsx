'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import FontEditor from '@/components/dashboard/FontEditor';
import { decodePrefill } from '@/lib/admin/prefill';

function NewFontInner() {
  const params = useSearchParams();
  const prefill = decodePrefill(params.get('from'));
  return <FontEditor key={params.get('from') ?? 'blank'} prefill={prefill ?? undefined} />;
}

export default function NewFont() {
  return <Suspense><NewFontInner /></Suspense>;
}
