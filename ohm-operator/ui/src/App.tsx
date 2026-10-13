import { useState } from "react";
import { api, SIDECAR_URL } from "./api";
import { useSidecar } from "./useSidecar";
import Chat from "./views/Chat";
import Home from "./views/Home";
import Voice from "./views/Voice";
import Projects from "./views/Projects";
import Tools from "./views/Tools";
import Bridge from "./views/Bridge";
import Memory from "./views/Memory";
import PermissionsView from "./views/Permissions";

export type ViewId = "home" | "chat" | "voice" | "projects" | "tools" | "bridge" | "memory" | "permissions";

const NAV: { id: ViewId; label: string; sanskrit: string }[] = [
  { id: "home", label: "Home", sanskrit: "Griha" },
  { id: "chat", label: "Chat", sanskrit: "Sambhasana" },
  { id: "voice", label: "Voice", sanskrit: "Vaani" },
  { id: "projects", label: "Projects", sanskrit: "Karya" },
  { id: "tools", label: "Tools", sanskrit: "Yantra" },
  { id: "bridge", label: "Bridge", sanskrit: "Setu" },
  { id: "memory", label: "Memory", sanskrit: "Smriti" },
  { id: "permissions", label: "Permissions", sanskrit: "Anumati" },
];

const fetchStatus = api.status;

export default function App() {
  const [view, setView] = useState<ViewId>("chat");
  const { data: status, error, refresh } = useSidecar(fetchStatus, 15000);
  const mode = status?.ui.mode ?? 0;
  const dual = mode !== -1;

  const body = {
    home: <Home status={status} />,
    chat: <Chat onActivity={refresh} />,
    voice: <Voice status={status} />,
    projects: <Projects />,
    tools: <Tools onActivity={refresh} />,
    bridge: <Bridge status={status?.bridge ?? null} onActivity={refresh} />,
    memory: <Memory status={status} />,
    permissions: <PermissionsView onActivity={refresh} />,
  }[view];

  return (
    <div className={`shell mode-${mode < 0 ? "archive" : mode > 0 ? "create" : "preserve"}`}>
      <nav className="sidebar" aria-label="Primary">
        <div className="brand">{dual ? "OM  Ohm" : "Ohm"}</div>
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`nav-item${view === n.id ? " active" : ""}`}
            aria-current={view === n.id ? "page" : undefined}
            onClick={() => setView(n.id)}
          >
            <span>{n.label}</span>
            {dual && <small>{n.sanskrit}</small>}
            {n.id === "permissions" && status && status.pending_approvals > 0 && (
              <span className="badge">{status.pending_approvals}</span>
            )}
          </button>
        ))}
        <div className="sidebar-foot">
          <div>mode {mode}</div>
          {error ? (
            <div className="dot bad" title={error}>sidecar offline</div>
          ) : (
            <>
              <div className={`dot ${status?.bridge.state === "fresh" ? "ok" : "warn"}`}>bridge {status?.bridge.state ?? "..."}</div>
              <div className={`dot ${status?.model.state === "online" ? "ok" : "warn"}`}>{status?.model.provider ?? "model"} {status?.model.state ?? "..."}</div>
            </>
          )}
        </div>
      </nav>
      <main className="content">
        {error && (
          <div className="banner">
            Sidecar unreachable at {SIDECAR_URL}. Start it with <code>python main.py</code> in ohm-operator/python-runtime.
          </div>
        )}
        {body}
      </main>
    </div>
  );
}
