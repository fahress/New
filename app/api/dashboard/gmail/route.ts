import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { staffFrom } from '@/lib/admin/server';
import { Gmail, MailError, authUrl, deleteAccount, gmailConfigured, loadAccount, revoke, saveAccount, sign, unseal, validAddresses } from '@/lib/admin/gmail';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const COOKIE = 'fz_gmail';
type Body = { action?: string; [k: string]: unknown };
const str = (v: unknown, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : '');

export async function POST(request: Request) {
  const staff = await staffFrom(request);
  if (!staff) return NextResponse.json({ error: 'Sign in to the dashboard first.' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Body;
  const action = str(body.action, 40);

  try {
    if (!gmailConfigured()) return NextResponse.json({ configured: false });
    // Only admins see the mailbox — editors still see website messages.
    if (staff.role !== 'admin') return action === 'status' ? NextResponse.json({ configured: true, allowed: false }) : NextResponse.json({ error: 'Only admins can use the mailbox.' }, { status: 403 });

    const origin = new URL(request.url).origin;

    if (action === 'connect') {
      const state = sign({ u: staff.userId, t: Date.now(), o: origin });
      return NextResponse.json({ url: authUrl(origin, state, str(body.hint, 320) || undefined) });
    }

    if (action === 'finish') {
      const jar = await cookies();
      const pending = unseal<{ u: string; r: string; e: string; t: number }>(jar.get(COOKIE)?.value);
      jar.delete({ name: COOKIE, path: '/api/dashboard/gmail' });
      if (!pending || pending.u !== staff.userId || Date.now() - pending.t > 15 * 60_000) throw new MailError('The Google sign-in expired. Click “Connect Gmail” again.');
      await saveAccount(staff, pending.e, pending.r);
      return NextResponse.json({ ok: true, email: pending.e });
    }

    const acct = await loadAccount(staff);
    if (action === 'status') {
      if (acct === 'no-table') return NextResponse.json({ configured: true, allowed: true, needsUpdate: true });
      if (acct === 'none') return NextResponse.json({ configured: true, allowed: true, connected: false });
      try {
        const unread = await new Gmail(acct.refresh, acct.email).unread();
        return NextResponse.json({ configured: true, allowed: true, connected: true, email: acct.email, unread });
      } catch (e) {
        return NextResponse.json({ configured: true, allowed: true, connected: true, email: acct.email, unread: 0, problem: e instanceof Error ? e.message : 'Gmail error' });
      }
    }
    if (acct === 'no-table') throw new MailError('Run the Messages database update first.', 409);
    if (acct === 'none') throw new MailError('Gmail isn’t connected.', 409);

    if (action === 'disconnect') {
      await revoke(acct.refresh);
      await deleteAccount(staff);
      return NextResponse.json({ ok: true });
    }

    const g = new Gmail(acct.refresh, acct.email);
    const id = str(body.id, 100);
    switch (action) {
      case 'list':
        return NextResponse.json(await g.list(str(body.q, 500) || 'in:inbox', str(body.pageToken, 200) || undefined));
      case 'thread':
        return NextResponse.json(await g.thread(id));
      case 'attachment':
        return NextResponse.json(await g.attachment(str(body.messageId, 100), str(body.attachmentId, 2000)));
      case 'read':
        await g.modify(id, [], ['UNREAD']); return NextResponse.json({ ok: true });
      case 'unread':
        await g.modify(id, ['UNREAD'], []); return NextResponse.json({ ok: true });
      case 'archive':
        await g.modify(id, [], ['INBOX']); return NextResponse.json({ ok: true });
      case 'inbox':
        await g.modify(id, ['INBOX'], []); return NextResponse.json({ ok: true });
      case 'trash':
        await g.trash(id); return NextResponse.json({ ok: true });
      case 'send': {
        const to = str(body.to, 4000);
        const cc = str(body.cc, 4000);
        const text = str(body.body, 100_000);
        if (!validAddresses(to)) throw new MailError('Check the “To” address.');
        if (cc && !validAddresses(cc)) throw new MailError('Check the “Cc” address.');
        if (!text.trim()) throw new MailError('Write a message first.');
        const sent = await g.send({
          to, cc: cc || undefined, subject: str(body.subject, 500) || '(no subject)', body: text,
          threadId: str(body.threadId, 100) || undefined, inReplyTo: str(body.inReplyTo, 1000) || undefined, references: str(body.references, 4000) || undefined,
        });
        return NextResponse.json({ ok: true, ...sent });
      }
      default:
        throw new MailError('Unknown action');
    }
  } catch (e) {
    const err = e instanceof MailError ? e : new MailError(e instanceof Error ? e.message : 'Something went wrong', 500);
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
}
