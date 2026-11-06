import 'server-only';
import type { AgentStore, HistoryRow, NewAsset, NewClaim, NewProposal, NewSource } from './store';
import type { ConversationRow, MessageRow, SourceRow } from './types';
import type { Supa } from './supa';

const days = (n: number) => new Date(Date.now() + n * 86400e3).toISOString();

/** AgentStore on Supabase, signed in as the person (row-level security keeps it to their own records). */
export class DbStore implements AgentStore {
  constructor(private db: Supa, public userId: string) {}

  async saveToolCall(row: Parameters<AgentStore['saveToolCall']>[0]) {
    await this.db.insert('agent_tool_calls', { ...row, owner_id: this.userId }, { onConflict: 'run_id,idx', ignoreDuplicates: true });
  }

  async saveSource(runId: string, conversationId: string, toolCallId: string, s: NewSource, retentionDays: number): Promise<SourceRow> {
    const [row] = await this.db.insert<SourceRow>('agent_sources', {
      owner_id: this.userId, run_id: runId, conversation_id: conversationId || null, tool_call_id: toolCallId, kind: s.kind, url: s.url.slice(0, 2000),
      title: s.title?.slice(0, 500) ?? null, publisher: s.publisher?.slice(0, 200) ?? null, excerpt: s.excerpt?.slice(0, 4000) ?? null, page: s.page,
      published_at: s.published_at, published_precision: s.published_precision, modified_at: s.modified_at, opened: s.opened,
      content_hash: s.content_hash ?? null, expires_at: days(retentionDays),
    });
    return row;
  }

  async findSources(conversationId: string, prefixes: string[]): Promise<SourceRow[]> {
    if (!prefixes.length || !conversationId) return [];
    // ids are uuids: compare on the text form of the first 8 characters
    const rows = await this.db.select<SourceRow>('agent_sources', { conversation_id: `eq.${conversationId}`, select: 'id,kind,url,title,publisher,excerpt,page,published_at,published_precision,modified_at,retrieved_at,opened', order: 'retrieved_at.desc', limit: 500 });
    return rows.filter((r) => prefixes.some((p) => r.id.startsWith(p)));
  }

  async saveClaims(runId: string, conversationId: string, claims: NewClaim[]): Promise<string[]> {
    if (!claims.length) return [];
    const rows = await this.db.insert<{ id: string }>('agent_claims', claims.map((c) => ({ ...c, owner_id: this.userId, run_id: runId, conversation_id: conversationId || null, value: c.value ?? null })));
    return rows.map((r) => r.id);
  }

  async createProposal(p: NewProposal) {
    const r = await this.db.rpc<{ id: string; version: number; changes: Record<string, unknown>[]; existing: boolean }>('agent_create_proposal', {
      p_run: p.run_id, p_tool_call: p.tool_call_id, p_message: p.message_id, p_kind: p.kind, p_title: p.title, p_reason: p.reason, p_impact: p.impact,
      p_targets: p.targets, p_changes: p.changes, p_evidence: p.evidence,
    });
    return r;
  }

  async saveAsset(runId: string, conversationId: string, a: NewAsset) {
    await this.db.insert('agent_assets', { ...a, owner_id: this.userId, run_id: runId, conversation_id: conversationId || null, status: 'staged' });
  }

  uploadStaging(path: string, bytes: Uint8Array, type: string) { return this.db.upload('agent-staging', path, bytes, type); }

  async signedAssetUrl(assetId: string) {
    const a = await this.db.one<{ staging_path: string }>('agent_assets', { id: `eq.${assetId}`, select: 'staging_path' });
    if (!a) return null;
    return (await this.db.signed('agent-staging', [a.staging_path], 600))[a.staging_path] ?? null;
  }

  async updateMessage(id: string, patch: Partial<MessageRow>) {
    await this.db.update('agent_messages', { id: `eq.${id}` }, { ...patch, updated_at: new Date().toISOString() });
  }

  async updateRun(id: string, patch: Record<string, unknown>) {
    await this.db.update('agent_runs', { id: `eq.${id}` }, patch);
  }

  async runStatus(id: string) {
    const r = await this.db.one<{ status: string }>('agent_runs', { id: `eq.${id}`, select: 'status' });
    return r?.status ?? null;
  }

  async updateConversation(id: string, patch: Partial<ConversationRow>) {
    await this.db.update('agent_conversations', { id: `eq.${id}` }, patch);
  }

  async userMessagesText(conversationId: string) {
    if (!conversationId) return '';
    const rows = await this.db.select<{ content: string }>('agent_messages', { conversation_id: `eq.${conversationId}`, role: 'eq.user', select: 'content', order: 'created_at.asc', limit: 200 });
    return rows.map((r) => r.content).join('\n');
  }

  async saveMemory(content: string, conversationId: string, retentionDays: number) {
    await this.db.insert('agent_memories', { owner_id: this.userId, kind: 'preference', content: content.slice(0, 600), source_conversation_id: conversationId || null, expires_at: days(retentionDays) });
  }

  async memories() {
    return this.db.select<{ id: string; content: string }>('agent_memories', { select: 'id,content', order: 'updated_at.desc', limit: 30, or: `(expires_at.is.null,expires_at.gt.${new Date().toISOString()})` });
  }

  async history(q: { entity_id?: string; entity?: string; limit: number }) {
    return this.db.select<HistoryRow>('activity_log', {
      select: 'id,at,user_email,action,entity,entity_id,label', order: 'at.desc', limit: Math.min(q.limit, 50),
      ...(q.entity_id ? { entity_id: `eq.${q.entity_id}` } : {}), ...(q.entity ? { entity: `eq.${q.entity}` } : {}),
    });
  }

  async createJob(title: string, instruction: string, items: { type: string; id: string; label: string }[], conversationId: string | null) {
    return this.db.rpc<string>('agent_job_create', { p_title: title, p_instruction: instruction, p_items: items, p_conversation: conversationId });
  }
}
