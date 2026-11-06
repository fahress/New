import 'server-only';
import crypto from 'node:crypto';
import { buildDeps, finishRun, integrations, runAgent, type AgentCtx } from './service';
import type { ConversationRow, MessageRow } from './types';

type Next = { state: 'item' | 'busy' | 'completed' | 'cancelled' | 'paused' | 'failed' | 'running'; item?: { id: string; idx: number; entity_type: string; entity_id: string; label: string; attempts: number }; instruction?: string; conversation_id?: string | null };

/**
 * Works through a batch job for up to `budgetMs`, one record at a time. Progress lives in the database:
 * stopping, a crash or a closed page loses at most the record in progress, which is retried (3 attempts).
 * Only one worker holds a job at a time (a lease with a token).
 */
export async function workJob(c: AgentCtx, jobId: string, budgetMs: number): Promise<{ state: string; processed: number }> {
  const token = crypto.randomUUID();
  const until = Date.now() + budgetMs;
  let processed = 0;
  const list = await integrations(c.db);
  for (;;) {
    if (Date.now() > until) return { state: 'running', processed };
    const next = await c.db.rpc<Next>('agent_job_next', { p_job: jobId, p_token: token });
    if (next.state !== 'item' || !next.item) return { state: next.state, processed };
    const it = next.item;
    const convId = next.conversation_id ?? null;
    let runId: string | null = null;
    try {
      const run = await c.db.rpc<{ id: string }>('agent_start_run', { p_conversation: convId, p_user_message: null, p_kind: 'job', p_idempotency: `job:${it.id}:${it.attempts}`, p_job_item: it.id });
      runId = run.id;
      const conv: ConversationRow = convId
        ? ((await c.db.one<ConversationRow>('agent_conversations', { id: `eq.${convId}`, select: '*' })) as ConversationRow)
        : { id: '', owner_id: c.staff.userId, title: '', title_auto: false, created_at: '', updated_at: '', archived_at: null, head_message_id: null, context_type: null, context_id: null, summary: null, summary_upto: null, focus: [], decisions: [] };
      const deps = buildDeps(c, list, run.id, conv.id);
      const ask: MessageRow = {
        id: crypto.randomUUID(), conversation_id: conv.id, parent_id: null, role: 'user', status: 'complete', run_id: null, client_request_id: null, cards: [], progress: [], error: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        content: `${next.instruction}\n\nRecord: ${it.entity_type} “${it.label}” (id ${it.entity_id}). Read it with get_record first.`,
      };
      const out = await runAgent(deps, { runId: run.id, conversation: { ...conv, focus: [], summary: null, summary_upto: null }, history: [ask], assistantMessageId: null, memories: [], context: null, mode: 'job' }, () => undefined);
      await finishRun(c, run.id, null, out);
      await c.db.rpc('agent_job_item_done', { p_item: it.id, p_token: token, p_ok: out.status === 'completed' || out.status === 'limit', p_summary: out.content.slice(0, 4000), p_run: run.id, p_proposals: out.proposals, p_error: out.error });
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 500) : 'error';
      await c.db.rpc('agent_job_item_done', { p_item: it.id, p_token: token, p_ok: false, p_summary: null, p_run: runId, p_proposals: [], p_error: msg }).catch(() => undefined);
      // limits or a switched-off agent: stop here and let the person resume later
      if (/limit|switched off|AG429|AG423/i.test(msg)) { await c.db.rpc('agent_job_control', { p_job: jobId, p_action: 'pause' }).catch(() => undefined); return { state: 'paused', processed }; }
    }
    processed++;
  }
}
