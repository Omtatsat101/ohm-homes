import { useState } from "react";
import { Status } from "../api";

export default function Voice({ status }: { status: Status | null }) {
  const [on, setOn] = useState(false);
  return (
    <section>
      <header className="view-head"><h1>Voice</h1></header>
      <label className="toggle">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        voice mode (placeholder)
      </label>
      <p className="muted">
        STT: {status?.voice.stt ?? "?"} - TTS: {status?.voice.tts ?? "?"}. Mic capture, transcription, and TTS are not wired in this slice.
      </p>
    </section>
  );
}
