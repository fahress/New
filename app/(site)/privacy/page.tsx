import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'How Fahress handles the information you send us.',
  alternates: { canonical: '/privacy' },
};

export default function Privacy() {
  return (
    <div className="wrap" style={{ paddingBlock: 'clamp(40px, 6vw, 88px) 120px' }}>
      <p className="mono muted" style={{ margin: '0 0 12px' }}>Privacy</p>
      <h1 className="display h-xl" style={{ margin: '0 0 32px' }}>Privacy policy.</h1>
      <div className="prose" style={{ maxWidth: 720 }}>
        <p>Fahress is an archive of Arabic typefaces, designers and foundries. You can browse it without an account, and we don’t sell or share personal information.</p>
        <h2>What we collect</h2>
        <p>Only what you send us: your name, email address and message when you use the <Link href="/contact">contact form</Link>, submit a font or suggest a correction; and your email address if you create a designer account. When you click a “buy” link, we count the click (which font and which link) so designers can see how many visitors Fahress sends them. This count contains no personal information.</p>
        <h2>How we use it</h2>
        <p>To answer your message, review your submission and run your account. Messages are read by the Fahress team in our dashboard and answered from our Fahress email address.</p>
        <h2>Email</h2>
        <p>The Fahress dashboard connects to the Fahress team’s own Gmail account so the team can read and reply to email in one place. Google user data accessed this way is used only to show and answer that mailbox, is not shared with anyone else, and is not used for advertising or to train AI models. Fahress’s use of information received from Google APIs follows the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">Google API Services User Data Policy</a>, including its Limited Use requirements.</p>
        <h2>Where it’s stored</h2>
        <p>Data is stored with our hosting and database providers (Vercel and Supabase). We keep messages for as long as they are useful for answering you, and you can ask us to delete anything you sent.</p>
        <h2>Contact</h2>
        <p>Questions or deletion requests: <Link href="/contact">contact us</Link> or email admin@fahress.com.</p>
      </div>
    </div>
  );
}
