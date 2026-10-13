import { api } from "../api";
import { useSidecar } from "../useSidecar";

const load = api.permissions;

export default function PermissionsView({ onActivity }: { onActivity: () => void }) {
  const { data, error, refresh } = useSidecar(load, 10000);

  async function resolve(id: string, decision: "approve" | "reject") {
    await api.resolve(id, decision).catch(() => undefined);
    refresh();
    onActivity();
  }

  if (error) return <p className="muted">{error}</p>;
  if (!data) return <p className="muted">waiting for sidecar...</p>;
  return (
    <section>
      <header className="view-head"><h1>Permissions</h1></header>
      <h2>Pending approvals</h2>
      {data.pending.length === 0 && <p className="muted">none</p>}
      <ul className="list">
        {data.pending.map((p) => (
          <li key={p.id}>
            <b>{p.kind}</b> {p.target} <small>{p.reason}</small>
            <button onClick={() => resolve(p.id, "approve")}>approve</button>
            <button className="ghost" onClick={() => resolve(p.id, "reject")}>reject</button>
          </li>
        ))}
      </ul>
      <h2>Policy</h2>
      <ul className="list">
        {Object.entries(data.policy).map(([k, v]) => (
          <li key={k}><b>{k}</b> <span className={`tag ${v}`}>{v}</span></li>
        ))}
      </ul>
      <h2>Connectors</h2>
      <ul className="list">
        {data.connectors.map((c) => (
          <li key={c.name}>
            <b>{c.name}</b> <span className="tag">{c.kind}</span>
            <span className={`tag ${c.enabled ? "allow" : "deny"}`}>{c.enabled ? "enabled" : "disabled"}</span>
            {c.kind === "outbound" && <span className="tag">{c.preauthorized ? "pre-authorized" : "confirm"}</span>}
            <small>{c.allowed_hosts.join(", ")}</small>
          </li>
        ))}
      </ul>
      <h2>Trusted export zones</h2>
      <ul className="list">{data.trusted_zones.map((z) => <li key={z}><small>{z}</small></li>)}</ul>
    </section>
  );
}
