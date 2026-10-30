import type { Metadata } from 'next';
import ContactForm from '@/components/ContactForm';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with the Fahress team — questions, licensing, partnerships or corrections.',
  alternates: { canonical: '/contact' },
};

export default function ContactPage() {
  return (
    <div className="wrap" style={{ paddingBlock: 'clamp(40px, 6vw, 88px) 120px' }}>
      <p className="mono muted" style={{ margin: '0 0 12px' }}>Contact</p>
      <h1 className="display h-xl" style={{ margin: '0 0 20px' }}>Write to Fahress.</h1>
      <p className="lede" style={{ margin: '0 0 clamp(32px, 5vw, 56px)' }}>Questions, licensing, partnerships or press — send us a message and we&apos;ll reply by email.</p>
      <ContactForm />
    </div>
  );
}
