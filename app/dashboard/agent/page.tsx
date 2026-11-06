'use client';
import { Suspense } from 'react';
import AgentChat from '@/components/agent/AgentChat';
import { Loading } from '@/components/dashboard/ui';

export default function AgentPage() {
  return <Suspense fallback={<Loading text="Opening the agent…" />}><AgentChat /></Suspense>;
}
