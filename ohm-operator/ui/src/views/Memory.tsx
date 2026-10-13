import { api, Status } from "../api";
import { useSidecar } from "../useSidecar";

const load = () => api.audit(25);

export default function Memory({ status }: { status: Status | null }) {
  const { data } = useSidecar(load, 15000);
  return (
    <section>
      <header className="view-head"><h1>Memory</h1></header>
      <p>Primer: {status?.memory.primer.path ?? "-"} ({status?.memory.primer.exists ? "found" : "missing"})</p>
      <p>Obsidian vault: {status?.memory.obsidian_vault.path ?? "-"} ({status?.memory.obsidian_vault.exists ? "found" : "missing"})</p>
      <h2>Recent audit</h2>
      <table className="audit">
        <thead><tr><th>time</th><th>action</th><th>target</th><th>decision</th><th>result</th></tr></thead>
        <tbody>
          {data?.map((a) => (
            <tr key={a.id}><td>{new Date(a.ts).toLocaleTimeString()}</td><td>{a.action}</td><td>{a.target}</td><td>{a.decision}</td><td>{a.result}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
