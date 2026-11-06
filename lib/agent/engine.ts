/**
 * The agent's run loop:
 *  1. build the context (rules, preferences, summary, recent records, the conversation so far),
 *  2. call the model with the tools this person may use,
 *  3. check each tool call (known tool, valid input) and run it within limits,
 *  4. keep the results and give them back to the model,
 *  5. repeat until the model answers, the step limit, the time limit, or a stop.
 * The engine only reads and prepares; approved changes run elsewhere (agent_execute_proposal).
 */
import crypto from 'node:crypto';
import { validate, toJsonSchema } from './schema';
import { availableTools, ToolRefusal, type ImageStager, type ToolCtx, type ToolDef } from './tools';
import { systemPrompt, SUMMARY_PROMPT } from './prompt';
import { AgentError, type ChatMessage, type ChatModel, type LlmResult, type SearchClient, type ToolCall } from './providers';
import { refPrefix } from './evidence';
import type { Index } from './archive';
import type { AgentSettings, FallbackError, Perm } from './settings';
import type { AgentStore } from './store';
import type { WebReader } from './web-reader';
import type { KnownSource } from './evidence';
import type { Card, ConversationRow, EntityRef, MessageRow, ProgressStep, StreamEvent } from './types';

export type Models = { primary: ChatModel; fallback: ChatModel | null; summary: ChatModel | null; vision: ChatModel | null };
/** What each model is known to support (from the provider's model list or the settings page check). null = unknown. */
export type Capabilities = { primaryTools: boolean | null; fallbackTools: boolean | null };

export type EngineDeps = {
  store: AgentStore; settings: AgentSettings; perms: Record<Perm, boolean>; role: string; models: Models; caps: Capabilities;
  search: SearchClient | null; web: WebReader; archive: () => Promise<Index>; imageUrl: (p: string) => string; stageImages: ImageStager | null;
  now?: () => Date;
};

export type RunInput = {
  runId: string; conversation: ConversationRow; history: MessageRow[]; assistantMessageId: string | null;
  memories: string[]; context: unknown | null; mode: 'chat' | 'job'; signal?: AbortSignal;
};

export type RunOutcome = { status: 'completed' | 'stopped' | 'failed' | 'limit'; content: string; cards: Card[]; progress: ProgressStep[]; error: string | null; provider: string; model: string; fallbackUsed: boolean; steps: number; proposals: string[] };

const TOOL_RESULT_MAX = 14000;
const approxTokens = (s: string) => Math.ceil(s.length / 3.2);

/** Builds the model's message list from the conversation path, fitting the context budget (newest first). */
export function buildHistory(history: MessageRow[], summaryUpto: string | null, budgetTokens: number): ChatMessage[] {
  let start = 0;
  if (summaryUpto) { const i = history.findIndex((m) => m.id === summaryUpto); if (i >= 0) start = i + 1; }
  const out: ChatMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= start; i--) {
    const m = history[i];
    let content = m.content;
    if (m.role === 'assistant') {
      const ents = m.cards.flatMap((c) => (c.kind === 'entities' ? c.items : [])).slice(0, 12);
      if (ents.length) content += `\n\n[Records shown in this reply: ${ents.map((e, n) => `${n + 1}. ${e.type} “${e.name}” id ${e.id}`).join('; ')}]`;
      const props = m.cards.filter((c) => c.kind === 'proposal').map((c) => (c as { id: string }).id);
      if (props.length) content += `\n[Proposals in this reply: ${[...new Set(props)].join(', ')}]`;
      if (m.status === 'stopped') content += '\n[This reply was stopped by the person.]';
    }
    const cost = approxTokens(content) + 8;
    if (used + cost > budgetTokens && out.length >= 2) break;
    used += cost;
    out.unshift(m.role === 'user' ? { role: 'user', content } : { role: 'assistant', content: content || '…' });
  }
  return out;
}

/** Replaces cited refs that aren't real sources of this conversation, and lists the ones that are. */
export function checkCitations(text: string, known: (prefix: string) => string | undefined): { text: string; ids: string[]; removed: number } {
  const ids: string[] = [];
  let removed = 0;
  const out = text.replace(/\[(src:[0-9a-f]{8})\]/gi, (m, ref: string) => {
    const id = known(refPrefix(ref) ?? '');
    if (!id) { removed++; return ''; }
    if (!ids.includes(id)) ids.push(id);
    return `[${ref.toLowerCase()}]`;
  });
  return { text: out.replace(/[ \t]+([.,،؛])/g, '$1'), ids, removed };
}

const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

export async function runAgent(deps: EngineDeps, input: RunInput, emit: (e: StreamEvent) => void): Promise<RunOutcome> {
  const s = deps.settings;
  const now = deps.now ?? (() => new Date());
  const started = Date.now();
  const deadline = started + s.limits.run_timeout_seconds * 1000;
  const ctrl = new AbortController();
  input.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  const timer = setTimeout(() => ctrl.abort(), s.limits.run_timeout_seconds * 1000);

  const cards: Card[] = [];
  const progress: ProgressStep[] = [];
  const focus: EntityRef[] = [...(input.conversation.focus ?? [])];
  const sources = new Map<string, KnownSource>();
  const proposals: string[] = [];
  const counters = { searches: 0 };
  let content = '';
  let provider: string = deps.models.primary.provider;
  let model = deps.models.primary.model;
  let fallbackUsed = false;
  let steps = 0;
  let stoppedByPerson = false;

  const step = (label: string, state: ProgressStep['state'] = 'running') => {
    const last = progress[progress.length - 1];
    if (last && last.state === 'running') last.state = 'done';
    progress.push({ label, state, at: now().toISOString() });
    emit({ type: 'progress', steps: progress.slice(-30) });
  };
  const finishStep = (state: ProgressStep['state'] = 'done') => { const last = progress[progress.length - 1]; if (last && last.state === 'running') { last.state = state; emit({ type: 'progress', steps: progress.slice(-30) }); } };
  const addCard = (c: Card) => {
    if (c.kind === 'sources') {
      const ex = cards.find((x) => x.kind === 'sources') as Extract<Card, { kind: 'sources' }> | undefined;
      if (ex) { ex.ids = [...new Set([...ex.ids, ...c.ids])]; emit({ type: 'card', card: ex }); return; }
    }
    if (c.kind === 'proposal') {
      if (!c.preselect) proposals.push(c.id);
      const i = cards.findIndex((x) => x.kind === 'proposal' && x.id === c.id);
      if (i >= 0) { cards[i] = c; emit({ type: 'card', card: c }); return; }
    }
    cards.push(c);
    emit({ type: 'card', card: c });
  };
  const addFocus = (e: EntityRef) => {
    const i = focus.findIndex((x) => x.id === e.id);
    if (i >= 0) focus.splice(i, 1);
    focus.unshift(e);
    focus.splice(12);
  };

  // throttled saves of the partial reply, so a reload or another tab can follow along
  let lastSave = 0;
  const save = async (force = false) => {
    if (!input.assistantMessageId) return;
    if (!force && Date.now() - lastSave < 1200) return;
    lastSave = Date.now();
    await deps.store.updateMessage(input.assistantMessageId, { content, cards, progress }).catch(() => undefined);
  };
  const onText = (d: string) => { content += d; emit({ type: 'delta', text: d }); void save(); };

  // a stop pressed in another tab (or the stop button) is seen here
  let lastCheck = 0;
  const stopped = async () => {
    if (ctrl.signal.aborted) return true;
    if (Date.now() - lastCheck < 1500) return false;
    lastCheck = Date.now();
    const st = await deps.store.runStatus(input.runId).catch(() => 'running');
    if (st && st !== 'running') { stoppedByPerson = true; ctrl.abort(); return true; }
    return false;
  };
  const stopWatch = setInterval(() => { void stopped(); }, 1500);

  try {
    /* ----- context ----- */
    let tools: ToolDef[] = availableTools(s, deps.perms, { search: !!deps.search, vision: !!deps.models.vision, images: !!deps.stageImages });
    let toolsNote: string | null = null;
    if (deps.caps.primaryTools === false) {
      toolsNote = `the model ${deps.models.primary.model} can’t call tools`;
      tools = [];
      step(`The chosen model can’t use tools — answering without checking Fahress or the web`, 'error');
    }
    let summary = input.conversation.summary;
    let summaryUpto = input.conversation.summary_upto;
    const historyTokens = input.history.reduce((n, m) => n + approxTokens(m.content), 0);
    const budget = Math.floor(s.limits.context_tokens * 0.55);
    if (historyTokens > budget && input.history.length > 8 && deps.models.summary !== null) {
      step('Summarising the earlier conversation');
      const cut = input.history.length - 6;
      const startAt = summaryUpto ? input.history.findIndex((m) => m.id === summaryUpto) + 1 : 0;
      const older = input.history.slice(Math.max(0, startAt), cut);
      if (older.length) {
        try {
          const r = await deps.models.summary.chat({
            messages: [{ role: 'system', content: SUMMARY_PROMPT }, { role: 'user', content: `${summary ? `Earlier summary:\n${summary}\n\n` : ''}${older.map((m) => `${m.role}: ${m.content.slice(0, 4000)}`).join('\n\n')}` }],
            max_tokens: 500, temperature: 0,
          }, { runId: input.runId, kind: 'summary', signal: ctrl.signal });
          summary = r.content.slice(0, 8000);
          summaryUpto = input.history[cut - 1].id;
          await deps.store.updateConversation(input.conversation.id, { summary, summary_upto: summaryUpto });
        } catch { /* keep going with the recent messages only */ }
      }
      finishStep();
    }
    const sys = systemPrompt({ settings: s, perms: deps.perms, role: deps.role, today: now().toISOString().slice(0, 10), toolsAvailable: tools.length > 0, toolsNote, memories: input.memories, summary, focus: focus.slice(0, 8), context: input.context, mode: input.mode });
    const messages: ChatMessage[] = [{ role: 'system', content: sys }, ...buildHistory(input.history, summaryUpto, Math.max(2000, s.limits.context_tokens - approxTokens(sys) - 3000))];
    const defs = tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: toJsonSchema(t.schema) } }));
    const byName = new Map(tools.map((t) => [t.name as string, t]));

    const seen = new Map<string, number>();
    let repeats = 0;
    let idx = 0;
    let final = false;

    for (let n = 0; n < s.limits.max_tool_steps + 1 && !final; n++) {
      if (await stopped()) break;
      if (Date.now() > deadline - 3000) { step('Time limit reached', 'error'); break; }
      const lastRound = n === s.limits.max_tool_steps;
      if (n === 0) step('Thinking about your request');
      const res = await callWithFallback(deps, input.runId, {
        messages, tools: lastRound || !defs.length ? undefined : defs, tool_choice: lastRound || !defs.length ? undefined : 'auto',
      }, ctrl.signal, onText, (m) => { provider = m.provider; model = m.model; }, () => { fallbackUsed = true; step(`Switched to the fallback model (${deps.models.fallback?.model})`); }, !!defs.length && !lastRound);
      finishStep();
      if (!res.toolCalls.length || lastRound) { final = true; break; }
      if (content && !content.endsWith('\n')) onText('\n\n');
      messages.push({ role: 'assistant', content: res.content || null, tool_calls: res.toolCalls });

      for (const call of res.toolCalls.slice(0, 6)) {
        if (await stopped()) break;
        const out = await runTool(deps, input, call, byName, idx++, {
          runId: input.runId, conversationId: input.conversation.id, messageId: input.assistantMessageId, userId: deps.store.userId, settings: s, perms: deps.perms,
          archive: deps.archive, imageUrl: deps.imageUrl, search: deps.search, web: deps.web, store: deps.store, vision: deps.models.vision, stageImages: deps.stageImages,
          sources, counters, signal: ctrl.signal, addCard, focus: addFocus, toolCallId: '',
        }, seen, step, deadline);
        if (out.repeat) repeats++;
        messages.push({ role: 'tool', tool_call_id: call.id, content: out.text });
      }
      for (const extra of res.toolCalls.slice(6)) messages.push({ role: 'tool', tool_call_id: extra.id, content: JSON.stringify({ error: 'Too many tool calls at once; call at most 6 per step.' }) });
      steps++;
      await deps.store.updateRun(input.runId, { steps, heartbeat_at: new Date().toISOString() }).catch(() => undefined);
      await save(true);
      if (repeats >= 3) { step('Stopped repeating the same lookups', 'error'); break; }
    }

    if (!final && !ctrl.signal.aborted && !content.trim()) {
      // limit reached without an answer: ask for one, without tools
      try {
        messages.push({ role: 'user', content: '[The tool limit for this reply was reached. Answer now with what you have, say what is still unchecked, and do not call tools.]' });
        await callWithFallback(deps, input.runId, { messages }, ctrl.signal, onText, (m) => { provider = m.provider; model = m.model; }, () => { fallbackUsed = true; }, false);
      } catch { /* answered below */ }
    }

    const wasStopped = ctrl.signal.aborted && (stoppedByPerson || !!input.signal?.aborted);
    const timedOut = ctrl.signal.aborted && !wasStopped;
    // citations: keep only real sources of this conversation
    const known = new Map<string, string>([...sources.entries()].map(([p, v]) => [p, v.id]));
    const cited = [...content.matchAll(/\[src:([0-9a-f]{8})\]/gi)].map((m) => m[1].toLowerCase()).filter((p) => !known.has(p));
    if (cited.length) for (const r of await deps.store.findSources(input.conversation.id, cited).catch(() => [])) known.set(r.id.slice(0, 8), r.id);
    const c = checkCitations(content, (p) => known.get(p));
    content = c.text;
    if (c.removed) content += `\n\n_${c.removed} citation${c.removed === 1 ? '' : 's'} removed: ${c.removed === 1 ? 'it doesn’t' : 'they don’t'} match a source opened in this conversation._`;
    if (c.ids.length) addCard({ kind: 'sources', ids: c.ids });
    if (timedOut) content += `${content ? '\n\n' : ''}_The reply hit the time limit (${s.limits.run_timeout_seconds} s) before finishing._`;
    finishStep(wasStopped ? 'error' : 'done');
    await deps.store.updateConversation(input.conversation.id, { focus, updated_at: new Date().toISOString() }).catch(() => undefined);
    const status = wasStopped ? 'stopped' : timedOut ? 'limit' : 'completed';
    return { status, content: content.trim(), cards, progress, error: null, provider, model, fallbackUsed, steps, proposals };
  } catch (e) {
    const err = e instanceof AgentError ? e : new AgentError(e instanceof Error ? e.message : 'Unexpected error');
    const stoppedNow = ctrl.signal.aborted && (stoppedByPerson || !!input.signal?.aborted);
    finishStep('error');
    return { status: stoppedNow ? 'stopped' : 'failed', content: content.trim(), cards, progress, error: stoppedNow ? null : err.message, provider, model, fallbackUsed, steps, proposals };
  } finally {
    clearTimeout(timer);
    clearInterval(stopWatch);
  }
}

/** One model call; a short retry for passing errors, then the fallback model if the settings allow it for this kind of error. */
async function callWithFallback(
  deps: EngineDeps, runId: string, req: Parameters<ChatModel['chat']>[0], signal: AbortSignal, onText: (d: string) => void,
  used: (m: ChatModel) => void, switched: () => void, needsTools: boolean,
): Promise<LlmResult> {
  let streamed = false;
  const track = (d: string) => { streamed = true; onText(d); };
  const kind = (e: AgentError): FallbackError | null => (e.code === 'rate_limited' ? 'rate_limited' : e.code === 'upstream' ? 'upstream' : e.code === 'network' || e.code === 'timeout' ? 'network' : null);
  const primary = deps.models.primary;
  try {
    used(primary);
    return await primary.chat(req, { runId, signal, onText: track, kind: 'chat' });
  } catch (e) {
    if (signal.aborted || !(e instanceof AgentError)) throw e;
    if (streamed) throw e; // text already shown: don't repeat it from another model
    if (e.retryable && e.code !== 'rate_limited') {
      await new Promise((r) => setTimeout(r, 1200));
      try { return await primary.chat(req, { runId, signal, onText: track, kind: 'chat' }); } catch (e2) { if (signal.aborted || !(e2 instanceof AgentError) || streamed) throw e2; e = e2; }
    }
    const err = e as AgentError;
    const fb = deps.models.fallback;
    const why = kind(err);
    if (!fb || !why || !deps.settings.models.fallback.enabled || !deps.settings.models.fallback.on_errors.includes(why)) throw err;
    if (needsTools && deps.caps.fallbackTools === false) throw new AgentError(`${err.message} The fallback model can’t use tools, so it wasn’t used.`, err.code, err.retryable);
    switched();
    used(fb);
    return fb.chat(req, { runId, signal, onText: track, kind: 'chat' });
  }
}

async function runTool(
  deps: EngineDeps, input: RunInput, call: ToolCall, byName: Map<string, ToolDef>, idx: number, base: ToolCtx,
  seen: Map<string, number>, step: (l: string, s?: ProgressStep['state']) => void, deadline: number,
): Promise<{ text: string; repeat: boolean }> {
  const id = crypto.randomUUID();
  const started = Date.now();
  const tool = byName.get(call.function.name);
  let args: Record<string, unknown> = {};
  const record = async (status: 'ok' | 'error' | 'rejected', output: unknown, error: string | null) => {
    await deps.store.saveToolCall({ id, run_id: input.runId, idx, name: call.function.name.slice(0, 64), input: args, output: shrink(output), status, error: error?.slice(0, 1000) ?? null, duration_ms: Date.now() - started }).catch(() => undefined);
  };
  if (!tool) {
    await record('rejected', null, 'unknown tool');
    return { text: JSON.stringify({ error: `There is no tool called “${call.function.name}”. Use only the tools you were given.` }), repeat: false };
  }
  try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
  const problems = validate(tool.schema, args);
  if (problems.length) {
    await record('rejected', null, problems.join('; '));
    return { text: JSON.stringify({ error: 'The tool input is invalid.', problems }), repeat: false };
  }
  const key = `${tool.name}:${canonical(args)}`;
  const times = seen.get(key) ?? 0;
  seen.set(key, times + 1);
  if (times >= 1 && tool.name !== 'select_changes') {
    await record('rejected', null, 'repeated call');
    return { text: JSON.stringify({ error: 'You already made this exact call in this reply. Use the earlier result; don’t repeat it.' }), repeat: true };
  }
  step(tool.progress(args));
  const ctx: ToolCtx = { ...base, toolCallId: id };
  const left = Math.max(5000, Math.min(60000, deadline - Date.now() - 2000));
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const r = await Promise.race([
      tool.run(ctx, args),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new AgentError(`The ${tool.name} step took too long.`, 'timeout', true)), left); }),
    ]).finally(() => clearTimeout(timer));
    await record('ok', r.output, null);
    return { text: shrinkText(JSON.stringify(r.output)), repeat: false };
  } catch (e) {
    const msg = e instanceof ToolRefusal || e instanceof AgentError ? e.message : e instanceof Error ? e.message.slice(0, 300) : 'Tool error';
    step(`${tool.progress(args)} — ${msg.slice(0, 80)}`, 'error');
    await record(e instanceof ToolRefusal ? 'rejected' : 'error', null, msg);
    return { text: JSON.stringify({ error: msg }), repeat: false };
  }
}

function shrinkText(s: string): string {
  return s.length <= TOOL_RESULT_MAX ? s : `${s.slice(0, TOOL_RESULT_MAX)}… [cut: the result was ${s.length} characters]`;
}
function shrink(v: unknown): unknown {
  const t = JSON.stringify(v ?? null);
  return t.length <= 60000 ? v : { truncated: true, preview: t.slice(0, 60000) };
}
