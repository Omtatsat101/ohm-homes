import { FormEvent, KeyboardEvent, useRef, useState } from "react";
import { api, EngineStatus, Speech } from "../api";
import { Recorder, startRecording } from "../recorder";
import { useSidecar } from "../useSidecar";

const loadStatus = api.voiceStatus;
const loadTranscript = api.voiceTranscript;

function play(s: Speech | null | undefined) {
  if (s?.status === "ok" && s.audio_base64) void new Audio(`data:${s.mime};base64,${s.audio_base64}`).play();
}

function Engine({ label, e }: { label: string; e: EngineStatus | null }) {
  if (!e) return null;
  return (
    <li>
      <b>{label}</b> <span className="tag">{e.engine ?? "none"}</span>
      <span className={`tag ${e.available ? "allow" : "deny"}`}>{e.available ? "available" : "unavailable"}</span>
      {!e.available && <small>{e.reason}</small>}
    </li>
  );
}

export default function Voice({ onActivity }: { onActivity: () => void }) {
  const status = useSidecar(loadStatus, 15000);
  const transcript = useSidecar(loadTranscript, 5000);
  const recorder = useRef<Recorder | null>(null);
  const starting = useRef(false);
  const released = useRef(false);
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState("");
  const [say, setSay] = useState("");
  const st = status.data;

  async function toggle(enabled: boolean) {
    try {
      const r = await api.setVoice(enabled);
      setNote(r.warning ?? "");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
    status.refresh();
    onActivity();
  }

  async function start() {
    if (recorder.current || starting.current) return;
    starting.current = true;
    released.current = false;
    try {
      recorder.current = await startRecording();
      setRecording(true);
      setNote("listening...");
    } catch (e) {
      setNote(`microphone unavailable: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      starting.current = false;
    }
    if (released.current && ptt) void stop();
  }

  async function stop() {
    const r = recorder.current;
    if (!r) {
      released.current = starting.current;
      return;
    }
    recorder.current = null;
    setRecording(false);
    setNote("transcribing...");
    try {
      const turn = await api.voiceTurn(await r.stop());
      setNote(turn.status === "ok" ? (turn.speech && turn.speech.status !== "ok" ? turn.speech.reason ?? "" : "") : `${turn.status}: ${turn.reason}`);
      play(turn.speech);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
    transcript.refresh();
    onActivity();
  }

  async function speak(e: FormEvent) {
    e.preventDefault();
    try {
      const s = await api.speak(say);
      setNote(s.status === "ok" ? `spoken with ${s.engine}` : `${s.status}: ${s.reason}`);
      play(s);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  }

  const ptt = st?.push_to_talk ?? true;
  const canTalk = !!st?.enabled && !!st.stt.available;
  const talkProps = ptt
    ? {
        onPointerDown: start,
        onPointerUp: stop,
        onPointerLeave: stop,
        onKeyDown: (e: KeyboardEvent) => { if (e.key === " " && !e.repeat) { e.preventDefault(); void start(); } },
        onKeyUp: (e: KeyboardEvent) => { if (e.key === " ") { e.preventDefault(); void stop(); } },
      }
    : { onClick: () => (recording ? stop() : start()) };

  if (status.error) return <p className="muted">{status.error}</p>;
  if (!st) return <p className="muted">waiting for sidecar...</p>;
  return (
    <section>
      <header className="view-head"><h1>Voice</h1><p className="wake">Vaani</p></header>
      <label className="toggle">
        <input type="checkbox" checked={st.enabled} onChange={(e) => toggle(e.target.checked)} />
        voice mode
      </label>
      <ul className="list">
        <Engine label="speech to text" e={st.stt} />
        <Engine label="text to speech" e={st.tts} />
        <Engine label="fallback voice" e={st.tts_fallback} />
      </ul>
      <button className={recording ? "recording" : ""} disabled={!canTalk} {...talkProps}>
        {recording ? "release to send" : ptt ? "hold to talk" : "click to talk"}
      </button>
      {note && <p className="muted">{note}</p>}
      <form className="composer" onSubmit={speak}>
        <input aria-label="Text to speak" placeholder="text to speak..." value={say} onChange={(e) => setSay(e.target.value)} />
        <button type="submit" disabled={!say.trim()}>speak</button>
      </form>
      <h2>Transcript</h2>
      {transcript.data?.length === 0 && <p className="muted">nothing yet</p>}
      <div className="messages">
        {transcript.data?.map((t, i) => (
          <div key={i} className={`msg ${t.role}`}>
            <div className="who">{t.role === "riket" ? "> riket" : "< ohm"} <small>{new Date(t.ts).toLocaleTimeString()}</small></div>
            <pre>{t.text}</pre>
          </div>
        ))}
      </div>
    </section>
  );
}
