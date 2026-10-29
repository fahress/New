import type { Metadata } from 'next';
import Link from 'next/link';
import { getArchive } from '@/lib/data';

export const revalidate = 600;
export const metadata: Metadata = {
  title: 'About',
  description: 'Fahress is a digital initiative dedicated to archiving and classifying Arabic type designers, foundries and typefaces.',
  alternates: { canonical: '/about' },
};

export default async function About() {
  const a = await getArchive();
  return (
    <div className="wrap" style={{ paddingBlock: '56px 96px', display: 'flex', flexWrap: 'wrap', gap: 48 }}>
      <div style={{ flex: '1 1 320px' }}>
        <p className="mono" style={{ margin: '0 0 16px' }}>About</p>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(48px, 7vw, 108px)', letterSpacing: '-.045em', lineHeight: .9 }}>Fahress means index.</h1>
      </div>
      <div className="prose" style={{ flex: '2 1 520px', minWidth: 0 }}>
        <p>Fahress is a digital initiative dedicated to the archiving and classification of Arabic type designers, foundries and typefaces. It aims to build a comprehensive, reliable database that serves as a primary reference for everyone working in, or interested in, Arabic type design.</p>
        <p>The name was chosen for its direct association with indexing and archiving — the essence of the project. Fahress brings order to an Arabic type market affected by piracy and unregulated distribution, and turns the search for Arabic typefaces into a clear, intelligent and safe experience.</p>
        <p>Today the archive holds <b>{a.fonts.length}</b> typefaces by <b>{a.people.filter((p) => p.type === 'designer' && p.fontIds.length).length}</b> designers and <b>{a.people.filter((p) => p.type === 'foundry' && p.fontIds.length).length}</b> foundries.</p>
        <h2>What we do</h2>
        <p>We highlight designers’ work on a professional, authoritative platform; structure Arabic typefaces into a clear system for browsing, comparison and precise search; help agencies, publishers and individuals find the right typeface for their technical and visual needs; and point everyone to licensed sources instead of unreliable downloads.</p>
        <h2 id="submit">Submit a font or claim your profile</h2>
        <p>Designed an Arabic typeface, or found one we’re missing? Send it through the submission form — every submission is reviewed by hand. Designers and foundries can create an account to claim their profile, keep their photo, bio and links up to date, and see how many visitors Fahress sends to their store.</p>
        <p style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/submit" className="btn">Submit a font</Link>
          <Link href="/account" className="btn btn--ghost">Claim your profile</Link>
          <a href="https://www.instagram.com/fahresstype" target="_blank" rel="noopener" className="btn btn--ghost">Follow on Instagram ↗</a>
        </p>
      </div>
    </div>
  );
}
