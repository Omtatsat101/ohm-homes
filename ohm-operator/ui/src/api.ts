export const SIDECAR_URL = import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:8765";

export type BundleState = "fresh" | "stale" | "missing";

export interface Bundle {
  name: string;
  path: string;
  state: BundleState;
  age_minutes: number | null;
  bytes: number | null;
}

export interface BridgeStatus {
  enabled: boolean;
  state: BundleState | "disabled";
  root: string | null;
  root_exists: boolean;
  script: { path: string; exists: boolean } | null;
  refresh_tool?: string;
  bundles: Bundle[];
}

export interface PathState {
  path: string | null;
  exists: boolean;
}

export interface Status {
  version: string;
  ui: { landing?: string; layout?: string; mode?: number; labels?: string };
  voice: { enabled: boolean; stt?: string | null; tts?: string | null; stt_available?: boolean; tts_available?: boolean };
  model: { provider?: string; state: string; name?: string; endpoint?: string; reason?: string };
  bridge: BridgeStatus;
  memory: { primer: PathState; obsidian_vault: PathState };
  secrets_file_present: boolean;
  pending_approvals: number;
  onboarding_completed: boolean;
}

export interface Approval {
  id: string;
  created: string;
  expires: string;
  kind: string;
  target: string;
  detail: { args?: string[] };
  reason: string;
}

export interface Tool {
  name: string;
  description: string;
  class: string;
  extra_args: boolean;
  decision: "allow" | "approve" | "deny";
}

export interface ChatReply {
  kind: string;
  reply: string;
  data?: { status?: string; approval_id?: string | null } & Record<string, unknown>;
}

export interface AuditEntry {
  id: number;
  ts: string;
  action: string;
  target: string;
  decision: string;
  result: string;
}

export interface Connector {
  name: string;
  kind: string;
  enabled: boolean;
  preauthorized: boolean;
  allowed_hosts: string[];
}

export interface Permissions {
  policy: Record<string, string>;
  trusted_zones: string[];
  connectors: Connector[];
  pending: Approval[];
}

export interface Project {
  name: string;
  path: string;
  git: boolean;
}

export interface HandoffFile {
  source: string;
  copy: string;
  bytes: number;
  sha256: string;
}

export interface Handoff {
  id: string;
  created: string;
  target: string;
  request: string;
  bundles: { name: string; path: string; state: BundleState; age_minutes: number | null }[];
  files: HandoffFile[];
  folder: string;
  reviews: number;
}

export interface Review {
  id: string;
  handoff_id: string;
  reviewer: string;
  created: string;
  source: string;
  sha256: string;
  text: string;
}

export interface BridgeResult {
  status: "ok" | "pending" | "denied" | "invalid" | "error";
  reason?: string;
  approval_id?: string;
  handoff?: Handoff;
  review?: Review;
}

export interface EngineStatus {
  engine: string | null;
  available: boolean;
  reason: string;
}

export interface VoiceStatus {
  enabled: boolean;
  push_to_talk: boolean;
  speak_replies: boolean;
  stt: EngineStatus;
  tts: EngineStatus;
  tts_fallback: EngineStatus | null;
  warning?: string;
}

export interface Speech {
  status: string;
  reason?: string;
  engine?: string;
  mime?: string;
  audio_base64?: string;
  fallback_from?: string[] | null;
}

export interface VoiceTurn {
  status: string;
  reason?: string;
  text?: string;
  reply?: ChatReply | null;
  speech?: Speech | null;
}

export interface TranscriptEntry {
  ts: string;
  role: "riket" | "ohm";
  text: string;
  engine: string | null;
}

export interface MemoryOverview {
  primer: PathState & { bytes?: number; modified?: string; text?: string; truncated?: boolean };
  vault: PathState & { writes_enabled: boolean; policy?: string };
}

export interface NoteInfo {
  path: string;
  bytes: number;
  modified: string;
}

export interface NoteResult {
  status: string;
  reason?: string;
  path?: string;
  text?: string;
  truncated?: boolean;
  approval_id?: string;
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SIDECAR_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  status: () => request<Status>("/status"),
  chat: (text: string) => request<ChatReply>("/chat", { text }),
  approvals: () => request<Approval[]>("/approvals"),
  resolve: (id: string, decision: "approve" | "reject") =>
    request<Record<string, unknown>>(`/approvals/${id}`, { decision }),
  tools: () => request<Tool[]>("/tools"),
  projects: () => request<Project[]>("/projects"),
  permissions: () => request<Permissions>("/permissions"),
  handoffs: () => request<Handoff[]>("/bridge/handoffs"),
  reviews: (handoff?: string) =>
    request<Review[]>(`/bridge/reviews${handoff ? `?handoff=${encodeURIComponent(handoff)}` : ""}`),
  createHandoff: (target: string, req: string, files: string[]) =>
    request<BridgeResult>("/bridge/handoffs", { target, request: req, files }),
  addReview: (handoff_id: string, reviewer: string, input: { text: string } | { path: string }) =>
    request<BridgeResult>("/bridge/reviews", { handoff_id, reviewer, ...input }),
  voiceStatus: () => request<VoiceStatus>("/voice/status"),
  voiceTranscript: () => request<TranscriptEntry[]>("/voice/transcript"),
  setVoice: (enabled: boolean) => request<VoiceStatus>("/voice/settings", { enabled }),
  voiceTurn: (audio_base64: string) => request<VoiceTurn>("/voice/turn", { audio_base64 }),
  speak: (text: string) => request<Speech>("/voice/speak", { text }),
  memory: () => request<MemoryOverview>("/memory"),
  notes: (q = "") => request<NoteInfo[]>(`/memory/notes?q=${encodeURIComponent(q)}`),
  note: (path: string) => request<NoteResult>(`/memory/note?path=${encodeURIComponent(path)}`),
  writeNote: (path: string, text: string, mode: "append" | "create") =>
    request<NoteResult>("/memory/notes", { path, text, mode }),
  audit: (limit = 25) => request<AuditEntry[]>(`/audit?limit=${limit}`),
};
