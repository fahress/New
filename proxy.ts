import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** /Dashboard (any capitalisation) → /dashboard. Route matching ignores case, so the check here is exact. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const lower = pathname.toLowerCase();
  if (lower.startsWith('/dashboard') && !pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard' + pathname.slice('/dashboard'.length);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next|api|favicon).*)'] };
