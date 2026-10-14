import { FormEvent, useState } from "react";
import { api, BridgeResult, BridgeStatus, Handoff } from "../api";
import { useSidecar } from "../useSidecar";

const loadHandoffs = api.handoffs;
const loadReviews = () => api.reviews();

function describe(r: BridgeResult): string {
  if (r.status === "ok") return r.handoff ? `handoff ${r.handoff.id} packaged` : `review ${r.review?.id} recorded`;
  if (r.status === "pending") return `needs approval (Permissions): ${r.reason}`;
  return `${r.status}: ${r.reason}`;
}

export default function Bridge({ status, onActivity }: { status: BridgeStatus | null; onActivity: () => void }) {
  const handoffs = useSidecar(loadHandoffs, 15000);
  const reviews = useSidecar(loadReviews, 15000);
  const [output, setOutput] = useState("");
  const [target, setTarget] = useState("");
  const [req, setReq] = useState("");
  const [files, setFiles] = useState("");
  const [reviewFor, setReviewFor] = useState<Handoff | null>(null);
  const [reviewer, setReviewer] = useState("");
  const [reviewText, setReviewText] = useState("");

  const targets = status?.bundles.map((b) => b.name) ?? [];

  async function act(fn: () => Promise<string>) {
    try {
      setOutput(await fn());
    } catch (e) {
      setOutput(e instanceof Error ? e.message : String(e));
    }
    handoffs.refresh();
    reviews.refresh();
    onActivity();
  }

  const refresh = () => act(async () => (await api.chat("/bridge refresh")).reply);

  function createHandoff(e: FormEvent) {
    e.preventDefault();
    const list = files.split("\n").map((f) => f.trim()).filter(Boolean);
    act(async () => {
      const r = await api.createHandoff(target || targets[0], req, list);
      if (r.status === "ok" || r.status === "pending") {
        setReq("");
        setFiles("");
      }
      return describe(r);
    });
  }

  function addReview(e: FormEvent) {
    e.preventDefault();
    if (!reviewFor) return;
    const t = reviewText.trim();
    const input = t.startsWith("@") ? { path: t.slice(1) } : { text: reviewText };
    act(async () => {
      const r = await api.addReview(reviewFor.id, reviewer || reviewFor.target, input);
      if (r.status === "ok" || r.status === "pending") setReviewText("");
      return describe(r);
    });
  }

  if (!status) return <p className="muted">waiting for sidecar...</p>;
  return (
    <section>
      <header className="view-head"><h1>Bridge</h1><p className="wake">Claude + Codex local-assist-bridge</p></header>
      <p>State: <b>{status.state}</b> - root {status.root ?? "not configured"} ({status.root_exists ? "found" : "missing"})</p>
      <p>Script: {status.script?.path ?? "-"} ({status.script?.exists ? "found" : "missing"})</p>
      <ul className="list">
        {status.bundles.map((b) => (
          <li key={b.name}>
            <b>{b.name}</b> <span className={`tag ${b.state}`}>{b.state}</span>
            <small>{b.path}{b.age_minutes !== null ? ` - ${b.age_minutes} min old, ${b.bytes} bytes` : ""}</small>
          </li>
        ))}
      </ul>
      <button onClick={refresh} disabled={!status.enabled}>refresh bundles</button>
      {output && <pre className="output">{output}</pre>}

      <h2>Package handoff</h2>
      <form className="form" onSubmit={createHandoff}>
        <label>target
          <select value={target || targets[0] || ""} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>request<textarea rows={3} value={req} onChange={(e) => setReq(e.target.value)} /></label>
        <label>files (one per line, relative to workspace)<textarea rows={2} value={files} onChange={(e) => setFiles(e.target.value)} /></label>
        <button type="submit" disabled={!req.trim() || targets.length === 0}>package</button>
      </form>

      <h2>Handoffs</h2>
      {handoffs.error && <p className="muted">{handoffs.error}</p>}
      {handoffs.data?.length === 0 && <p className="muted">none yet</p>}
      <ul className="list">
        {handoffs.data?.map((h) => (
          <li key={h.id}>
            <b>{h.id}</b> <span className="tag">{h.target}</span>
            <span className="tag">{h.files.length} files</span><span className="tag">{h.reviews} reviews</span>
            {h.bundles.map((b) => <span key={b.name} className={`tag ${b.state}`}>{b.name} {b.state}</span>)}
            <button className="ghost" onClick={() => { setReviewFor(h); setReviewer(h.target); }}>add review</button>
            <small>{h.request}</small>
            <small>{h.folder}</small>
          </li>
        ))}
      </ul>

      {reviewFor && (
        <form className="form" onSubmit={addReview}>
          <h2>Review intake for {reviewFor.id}</h2>
          <label>reviewer
            <select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
              {targets.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>review text, or @path to a review file<textarea rows={4} value={reviewText} onChange={(e) => setReviewText(e.target.value)} /></label>
          <div>
            <button type="submit" disabled={!reviewText.trim()}>record review</button>
            <button type="button" className="ghost" onClick={() => setReviewFor(null)}>close</button>
          </div>
        </form>
      )}

      <h2>Reviews</h2>
      {reviews.data?.length === 0 && <p className="muted">none yet</p>}
      <ul className="list">
        {reviews.data?.map((r) => (
          <li key={r.id}>
            <b>{r.reviewer}</b> <span className="tag">{r.handoff_id}</span>
            <small>{r.source === "text" ? "" : `from ${r.source} - `}{new Date(r.created).toLocaleString()}</small>
            <pre className="output">{r.text}</pre>
          </li>
        ))}
      </ul>
    </section>
  );
}
