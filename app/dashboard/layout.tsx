import type { Metadata } from 'next';
import Shell from '@/components/dashboard/Shell';
import './dashboard.css';

export const metadata: Metadata = {
  title: { default: 'Dashboard', template: '%s · Dashboard | Fahress' },
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
