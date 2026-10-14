import { useState } from "react";
import { api } from "../api";
import { useSidecar } from "../useSidecar";

const load = api.tools;

export default function Tools({ onActivity }: { onActivity: () => void }) {
  const { data, error } = useSidecar(load);
  const [output, setOutput] = useState("");

  async function run(name: string) {
    try {
      setOutput((await api.chat(`/run ${name}`)).reply);
    } catch (e) {
      setOutput(e instanceof Error ? e.message : String(e));
    }
    onActivity();
  }

  return (
    <section>
      <header className="view-head"><h1>Tools</h1></header>
      {error && <p className="muted">{error}</p>}
      <ul className="list">
        {data?.map((t) => (
          <li key={t.name}>
            <b>{t.name}</b> <span className={`tag ${t.decision}`}>{t.decision}</span>
            <small>{t.description}</small>
            {!t.extra_args && t.decision !== "deny" && <button onClick={() => run(t.name)}>run</button>}
          </li>
        ))}
      </ul>
      {output && <pre className="output">{output}</pre>}
    </section>
  );
}
