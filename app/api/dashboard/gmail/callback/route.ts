import { NextResponse } from 'next/server';
import { Gmail, exchangeCode, gmailConfigured, seal, verify } from '@/lib/admin/gmail';

export const dynamic = 'force-dynamic';

/**
 * Google sends the admin back here after "Connect Gmail".
 * The sign-in is parked in a short-lived, encrypted, http-only cookie; the Inbox page then
 * calls { action: 'finish' } with the admin's dashboard login, which saves it to the database.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = verify<{ u: string; t: number; o: string }>(url.searchParams.get('state'));
  const origin = state?.o ?? url.origin;
  const back = (q: string) => NextResponse.redirect(`${origin}/dashboard/inbox?${q}`);

  if (!gmailConfigured()) return back('gmail=error&reason=not-configured');
  if (!state || Date.now() - state.t > 15 * 60_000) return back('gmail=error&reason=expired');
  if (url.searchParams.get('error')) return back('gmail=error&reason=denied');
  const code = url.searchParams.get('code');
  if (!code) return back('gmail=error&reason=missing-code');

  try {
    const tok = await exchangeCode(code, origin);
    if (!tok.refresh_token) return back('gmail=error&reason=no-refresh');
    const { emailAddress } = await new Gmail(tok.refresh_token, '').profile();
    const res = back('gmail=connected');
    res.cookies.set('fz_gmail', seal({ u: state.u, r: tok.refresh_token, e: emailAddress, t: Date.now() }), {
      httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', path: '/api/dashboard/gmail', maxAge: 15 * 60,
    });
    return res;
  } catch {
    return back('gmail=error&reason=exchange');
  }
}
