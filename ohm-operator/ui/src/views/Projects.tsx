import { api } from "../api";
import { useSidecar } from "../useSidecar";

const load = api.projects;

export default function Projects() {
  const { data, error } = useSidecar(load);
  return (
    <section>
      <header className="view-head"><h1>Projects</h1></header>
      {error && <p className="muted">{error}</p>}
      {data && data.length === 0 && <p className="muted">No projects found at paths.projects.</p>}
      <ul className="list">
        {data?.map((p) => (
          <li key={p.path}><b>{p.name}</b> {p.git && <span className="tag">git</span>}<small>{p.path}</small></li>
        ))}
      </ul>
    </section>
  );
}
