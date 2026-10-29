import type { Metadata } from 'next';
import { Suspense } from 'react';
import Account from '@/components/account/Account';

export const metadata: Metadata = { title: 'Your account', robots: { index: false } };

export default function AccountPage() {
  return (
    <div className="wrap" style={{ paddingBlock: 'clamp(40px, 6vw, 88px) 120px' }}>
      <p className="mono muted" style={{ margin: '0 0 12px' }}>Account</p>
      <h1 className="display h-xl" style={{ margin: '0 0 clamp(32px, 5vw, 64px)' }}>Your Fahress.</h1>
      <Suspense><Account /></Suspense>
    </div>
  );
}
