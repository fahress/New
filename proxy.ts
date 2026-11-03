import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** /Dashboard (any capitalisation) → /dashboard. Route matching ignores case, so the check here is exact. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // the old admin address now opens the dashboard on the main site
  if ((request.headers.get('host') ?? '').toLowerCase().startsWith('admin.')) {
    // the old admin's own page addresses don't exist here, so every address goes to the dashboard home
    return NextResponse.redirect('https://fahress.com/dashboard', 308);
  }
  const lower = pathname.toLowerCase();
  if (lower.startsWith('/dashboard') && !pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard' + pathname.slice('/dashboard'.length);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next|api|favicon).*)'] };
