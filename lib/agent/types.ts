/** Shapes shared by the agent's server code and the dashboard UI. */

export type EntityRef = { type: 'font' | 'designer' | 'foundry'; id: string; name: string; status?: string };

export type Card =
  | { kind: 'sources'; ids: string[] }
  | { kind: 'proposal'; id: string; preselect?: string[] }
  | { kind: 'images'; assets: string[]; entity?: EntityRef | null; note?: string }
  | { kind: 'entities'; title: string; items: (EntityRef & { detail?: string })[]; total?: number }
  | { kind: 'findings'; entity: EntityRef | null; rows: FindingRow[] }
  | { kind: 'duplicates'; groups: { type: string; strength: 'strong' | 'possible'; signals: string[]; against: string[]; records: { id: string; name: string; detail: string }[] }[] }
  | { kind: 'job'; id: string; title: string };

export type FindingRow = {
  field: string; ours: unknown; found: unknown; status: 'supported' | 'inferred' | 'conflicting' | 'unverified';
  sources: string[]; quote?: string | null; date_kind?: string | null; precision?: string | null; note?: string | null;
};

export type ProgressStep = { label: string; state: 'running' | 'done' | 'error'; at: string };

export type MessageRow = {
  id: string; conversation_id: string; parent_id: string | null; role: 'user' | 'assistant'; content: string;
  status: 'complete' | 'streaming' | 'error' | 'stopped'; run_id: string | null; client_request_id: string | null;
  cards: Card[]; progress: ProgressStep[]; error: string | null; created_at: string; updated_at: string;
};

export type ConversationRow = {
  id: string; owner_id: string; title: string; title_auto: boolean; created_at: string; updated_at: string; archived_at: string | null;
  head_message_id: string | null; context_type: 'font' | 'designer' | 'foundry' | null; context_id: string | null;
  summary: string | null; summary_upto: string | null; focus: EntityRef[]; decisions: string[];
};

export type SourceRow = {
  id: string; kind: 'web' | 'pdf' | 'search_result' | 'archive'; url: string; title: string | null; publisher: string | null; excerpt: string | null;
  page: number | null; published_at: string | null; published_precision: string | null; modified_at: string | null; retrieved_at: string; opened: boolean;
};

export type ProposalOp = Record<string, unknown> & { id: string; op: string };
export type ProposalRow = {
  id: string; owner_id: string; conversation_id: string | null; message_id: string | null; run_id: string | null; version: number;
  status: 'pending' | 'executing' | 'executed' | 'rejected' | 'cancelled' | 'expired' | 'conflict' | 'failed' | 'superseded';
  kind: string; title: string; reason: string | null; impact: string | null; targets: { type: string; id: string; label?: string }[];
  changes: ProposalOp[]; base: Record<string, string>; evidence: EvidenceItem[]; submitted_for_review: boolean; expires_at: string;
  created_at: string; updated_at: string; executed_at: string | null; executed_by: string | null; result: Record<string, unknown> | null; error: string | null;
};
export type EvidenceItem = {
  change_id: string; source_id: string | null; url: string | null; title: string | null; publisher: string | null; quote: string | null;
  status: 'supported' | 'inferred' | 'conflicting' | 'unverified' | 'user_provided'; date_kind: string | null; precision: string | null;
  published_at: string | null; retrieved_at: string | null;
};

export type AssetRow = {
  id: string; source_url: string; page_url: string | null; staging_path: string; sha256: string; dhash: string | null; mime: string; bytes: number;
  width: number; height: number; kind: 'specimen' | 'designer_photo' | 'foundry_logo' | 'unknown'; status: 'staged' | 'attached' | 'discarded'; attached_path: string | null; created_at: string;
};

/** Events streamed to the chat while the agent works. */
export type StreamEvent =
  | { type: 'meta'; conversation_id: string; user_message_id: string | null; assistant_message_id: string; run_id: string }
  | { type: 'progress'; steps: ProgressStep[] }
  | { type: 'delta'; text: string }
  | { type: 'card'; card: Card }
  | { type: 'done'; message: MessageRow }
  | { type: 'error'; message: string; code: string; retryable: boolean };
