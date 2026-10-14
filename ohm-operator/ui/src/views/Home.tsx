import { Status } from "../api";

export default function Home({ status }: { status: Status | null }) {
  if (!status) return <p className="muted">waiting for sidecar...</p>;
  return (
    <section>
      <header className="view-head"><h1>Home</h1></header>
      <div className="cards">
        <div className="card"><h2>Model</h2><p>{status.model.provider} {status.model.name}: <b>{status.model.state}</b></p></div>
        <div className="card"><h2>Bridge</h2><p><b>{status.bridge.state}</b></p></div>
        <div className="card"><h2>Pending approvals</h2><p><b>{status.pending_approvals}</b></p></div>
        <div className="card"><h2>Primer</h2><p>{status.memory.primer.exists ? "found" : "missing"}</p></div>
      </div>
      <p className="muted">Morning summary, active sprint, and recent tasks land in a later slice.</p>
    </section>
  );
}
