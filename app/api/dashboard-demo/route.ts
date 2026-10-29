import { NextResponse } from 'next/server';

/** Local testing only: serves the offline snapshot to the dashboard's demo mode. Off unless FAHRESS_FIXTURE is set. */
export async function GET() {
  const file = process.env.FAHRESS_FIXTURE;
  if (!file || process.env.NEXT_PUBLIC_DASHBOARD_DEMO !== '1') return new NextResponse('Not found', { status: 404 });
  const { readFile } = await import('node:fs/promises');
  return new NextResponse(await readFile(file, 'utf8'), { headers: { 'content-type': 'application/json' } });
}
