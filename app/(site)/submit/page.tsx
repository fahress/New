import type { Metadata } from 'next';
import SubmitFont from '@/components/account/SubmitFont';

export const metadata: Metadata = {
  title: 'Submit a font',
  description: 'Send an Arabic typeface to the Fahress archive. Every submission is reviewed by hand and credited to its designers and foundry.',
};

export default function SubmitPage() {
  return (
    <div className="wrap" style={{ paddingBlock: 'clamp(40px, 6vw, 88px) 120px' }}>
      <p className="mono muted" style={{ margin: '0 0 12px' }}>Submit</p>
      <h1 className="display h-xl" style={{ margin: '0 0 20px' }}>Add a typeface to the archive.</h1>
      <p className="lede" style={{ margin: '0 0 clamp(32px, 5vw, 56px)' }}>Designed an Arabic typeface, or found one we&apos;re missing? Send it in. We credit every designer and foundry, and link straight to where it can be bought or downloaded.</p>
      <SubmitFont />
    </div>
  );
}
