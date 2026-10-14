import { FormEvent, useCallback, useState } from "react";
import { api, NoteResult } from "../api";
import { useSidecar } from "../useSidecar";

const loadAudit = () => api.audit(25);
const loadMemory = api.memory;

export default function Memory({ onActivity }: { onActivity: () => void }) {
  const memory = useSidecar(loadMemory, 30000);
  const audit = useSidecar(loadAudit, 15000);
  const [query, setQuery] = useState("");
  const loadNotes = useCallback(() => api.notes(query), [query]);
  const notes = useSidecar(loadNotes);
  const [open, setOpen] = useState<NoteResult | null>(null);
  const [path, setPath] = useState("");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"append" | "create">("append");
  const [note, setNote] = useState("");

  async function show(p: string) {
    try {
      setOpen(await api.note(p));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }

  async function write(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api.writeNote(path, text, mode);
      setNote(r.status === "ok" ? `${mode === "create" ? "created" : "appended to"} ${r.path}` : r.status === "pending" ? `needs approval (Permissions): ${r.reason}` : `${r.status}: ${r.reason}`);
      if (r.status === "ok" || r.status === "pending") setText("");
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
    notes.refresh();
    audit.refresh();
    onActivity();
  }

  const m = memory.data;
  return (
    <section>
      <header className="view-head"><h1>Memory</h1><p className="wake">Smriti</p></header>
      {memory.error && <p className="muted">{memory.error}</p>}
      <h2>Primer</h2>
      <p><small className="muted">{m?.primer.path ?? "-"} ({m?.primer.exists ? `found, ${m.primer.bytes} bytes` : "missing"})</small></p>
      {m?.primer.text && <pre className="output">{m.primer.text}{m.primer.truncated ? "\n..." : ""}</pre>}

      <h2>Obsidian vault</h2>
      <p>
        <small className="muted">{m?.vault.path ?? "-"} ({m?.vault.exists ? "found" : "missing"})</small>{" "}
        <span className={`tag ${m?.vault.writes_enabled ? m.vault.policy ?? "approve" : "deny"}`}>
          {m?.vault.writes_enabled ? `writes: ${m.vault.policy ?? "approve"}` : "read-only"}
        </span>
      </p>
      <div className="composer">
        <input aria-label="Search notes" placeholder="filter notes..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <ul className="list">
        {notes.data?.map((n) => (
          <li key={n.path}>
            <b>{n.path}</b> <small>{new Date(n.modified).toLocaleString()} - {n.bytes} bytes</small>
            <button className="ghost" onClick={() => show(n.path)}>open</button>
          </li>
        ))}
      </ul>
      {notes.data?.length === 0 && <p className="muted">no notes</p>}
      {open && (
        <div>
          <h2>{open.path ?? "note"} <button className="ghost" onClick={() => setOpen(null)}>close</button></h2>
          <pre className="output">{open.text ?? `${open.status}: ${open.reason}`}{open.truncated ? "\n..." : ""}</pre>
        </div>
      )}

      {m?.vault.writes_enabled && (
        <form className="form" onSubmit={write}>
          <h2>Write to vault</h2>
          <label>note path (relative, .md)<input value={path} onChange={(e) => setPath(e.target.value)} /></label>
          <label>mode
            <select value={mode} onChange={(e) => setMode(e.target.value as "append" | "create")}>
              <option value="append">append</option>
              <option value="create">create</option>
            </select>
          </label>
          <label>text<textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} /></label>
          <button type="submit" disabled={!path.trim() || !text.trim()}>write</button>
        </form>
      )}
      {note && <p className="muted">{note}</p>}

      <h2>Recent audit</h2>
      <table className="audit">
        <thead><tr><th>time</th><th>action</th><th>target</th><th>decision</th><th>result</th></tr></thead>
        <tbody>
          {audit.data?.map((a) => (
            <tr key={a.id}><td>{new Date(a.ts).toLocaleTimeString()}</td><td>{a.action}</td><td>{a.target}</td><td>{a.decision}</td><td>{a.result}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
