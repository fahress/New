import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="wrap" style={{ paddingBlock: '96px 120px' }}>
      <p className="mono">404</p>
      <h1 className="display h-xl" style={{ margin: '0 0 24px' }}>This page isn’t in the index.</h1>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/fonts" className="btn">Browse the catalog</Link>
        <Link href="/" className="btn btn--ghost">Go home</Link>
      </div>
    </div>
  );
}
