import { NextResponse } from 'next/server';

/** Local testing only: serves the offline snapshot (plus sample inbox items) to the dashboard's demo mode. Off unless FAHRESS_FIXTURE is set. */
export async function GET() {
  const file = process.env.FAHRESS_FIXTURE;
  if (!file || process.env.NEXT_PUBLIC_DASHBOARD_DEMO !== '1') return new NextResponse('Not found', { status: 404 });
  const { readFile } = await import('node:fs/promises');
  const d = JSON.parse(await readFile(file, 'utf8'));
  const person = d.designers.find((p: { user_id: string | null }) => !p.user_id) ?? d.designers[0];
  const font = d.fonts[0];
  const now = new Date().toISOString();
  d.submissions ??= [
    { id: 's1', created_at: now, kind: 'font', status: 'new', email: 'designer@example.com', name: 'Sara', payload: { name: 'Sample Kufi', designers: ['Mostafa Abasiry', 'New Person'], year: '2025', license: 'paid', links: ['https://example.com/fonts/sample-kufi'], description: 'A geometric Kufi for headlines.', is_designer: true } },
    { id: 's2', created_at: now, kind: 'correction', status: 'new', font_id: font.id, message: 'The buy link has moved.', payload: {} },
    { id: 's3', created_at: now, kind: 'claim', status: 'new', designer_id: person.id, user_id: 'u-demo', email: 'me@example.com', message: 'This is me.', payload: { name: person.name, proof: 'https://instagram.com/example' } },
    { id: 's4', created_at: now, kind: 'profile_edit', status: 'new', designer_id: person.id, user_id: 'u-demo', payload: { name: person.name, changes: { bio: 'New bio text from the designer.', country: 'Jordan', social_links: { website_url: 'https://example.com' } } } },
  ];
  d.link_checks ??= [];
  d.font_redirects ??= [];
  d.activity_log ??= [];
  d.dashboard_roles ??= [];
  return NextResponse.json(d);
}
