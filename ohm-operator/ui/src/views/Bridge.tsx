import { useState } from "react";
import { api, BridgeStatus } from "../api";

export default function Bridge({ status, onActivity }: { status: BridgeStatus | null; onActivity: () => void }) {
  const [output, setOutput] = useState("");

  async function refresh() {
    try {
      setOutput((await api.chat("/bridge refresh")).reply);
    } catch (e) {
      setOutput(e instanceof Error ? e.message : String(e));
    }
    onActivity();
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
    </section>
  );
}
