/**
 * Where the agent keeps its work: messages, tool calls, sources, findings, proposals, images, memory.
 * The engine only sees this interface; DbStore writes to Supabase as the signed-in person,
 * and the tests use an in-memory version.
 */
import type { Card, ConversationRow, EvidenceItem, MessageRow, ProgressStep, SourceRow } from './types';

export type NewSource = Omit<SourceRow, 'id' | 'retrieved_at'> & { content_hash?: string | null };
export type NewClaim = {
  entity_type: 'font' | 'designer' | 'foundry' | null; entity_id: string | null; field: string; value: unknown; source_id: string | null; excerpt: string | null;
  date_kind: string | null; date_precision: string | null; status: 'supported' | 'inferred' | 'conflicting' | 'unverified'; rationale: string | null;
};
export type NewProposal = {
  run_id: string; tool_call_id: string; message_id: string | null; kind: string; title: string; reason: string; impact: string | null;
  targets: { type: string; id: string; label?: string }[]; changes: Record<string, unknown>[]; evidence: EvidenceItem[];
};
export type NewAsset = { id: string; source_url: string; page_url: string | null; staging_path: string; sha256: string; dhash: string; mime: string; bytes: number; width: number; height: number; kind: string };
export type HistoryRow = { id: number; at: string; user_email: string | null; action: string; entity: string; entity_id: string | null; label: string | null; before?: unknown; after?: unknown };

export interface AgentStore {
  userId: string;
  saveToolCall(row: { id: string; run_id: string; idx: number; name: string; input: unknown; output: unknown; status: 'ok' | 'error' | 'rejected'; error: string | null; duration_ms: number }): Promise<void>;
  saveSource(runId: string, conversationId: string, toolCallId: string, s: NewSource, retentionDays: number): Promise<SourceRow>;
  /** Sources this conversation already has, by id prefix (the `src:xxxxxxxx` the model cites). */
  findSources(conversationId: string, prefixes: string[]): Promise<SourceRow[]>;
  saveClaims(runId: string, conversationId: string, claims: NewClaim[]): Promise<string[]>;
  createProposal(p: NewProposal): Promise<{ id: string; version: number; changes: Record<string, unknown>[]; existing: boolean }>;
  saveAsset(runId: string, conversationId: string, a: NewAsset): Promise<void>;
  uploadStaging(path: string, bytes: Uint8Array, type: string): Promise<void>;
  /** A short-lived link to a staged image (for the vision model and previews). */
  signedAssetUrl(assetId: string): Promise<string | null>;
  updateMessage(id: string, patch: Partial<Pick<MessageRow, 'content' | 'status' | 'cards' | 'progress' | 'error'>>): Promise<void>;
  updateRun(id: string, patch: { status?: string; steps?: number; provider?: string; model?: string; fallback_used?: boolean; finished_at?: string; error?: string | null; heartbeat_at?: string }): Promise<void>;
  runStatus(id: string): Promise<string | null>;
  updateConversation(id: string, patch: Partial<Pick<ConversationRow, 'title' | 'focus' | 'decisions' | 'summary' | 'summary_upto' | 'updated_at'>>): Promise<void>;
  userMessagesText(conversationId: string): Promise<string>;
  saveMemory(content: string, conversationId: string, retentionDays: number): Promise<void>;
  memories(): Promise<{ id: string; content: string }[]>;
  history(q: { entity_id?: string; entity?: string; limit: number }): Promise<HistoryRow[]>;
  createJob(title: string, instruction: string, items: { type: string; id: string; label: string }[], conversationId: string | null): Promise<string>;
}

export type { Card, ProgressStep };
