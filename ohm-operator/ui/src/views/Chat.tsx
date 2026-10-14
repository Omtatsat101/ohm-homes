import { FormEvent, useEffect, useRef, useState } from "react";
import { api, ChatReply } from "../api";

interface Message {
  from: "riket" | "ohm";
  text: string;
  approvalId?: string;
}

export default function Chat({ onActivity }: { onActivity: () => void }) {
  const [messages, setMessages] = useState<Message[]>([
    { from: "ohm", text: "namaste, riket. Type /help for commands." },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages]);

  const push = (m: Message) => setMessages((prev) => [...prev, m]);

  const toMessage = (r: ChatReply): Message => ({
    from: "ohm",
    text: r.reply,
    approvalId: r.data?.status === "pending" ? (r.data.approval_id ?? undefined) : undefined,
  });

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    push({ from: "riket", text });
    setBusy(true);
    try {
      push(toMessage(await api.chat(text)));
    } catch (err) {
      push({ from: "ohm", text: `sidecar error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
      onActivity();
    }
  }

  async function resolve(id: string, decision: "approve" | "reject") {
    try {
      const r = await api.resolve(id, decision);
      const out = (r.stdout as string) || (r.reason as string) || String(r.status);
      push({ from: "ohm", text: `${decision}: ${out}`.trim() });
    } catch (err) {
      push({ from: "ohm", text: `sidecar error: ${err instanceof Error ? err.message : String(err)}` });
    }
    onActivity();
  }

  return (
    <section className="chat">
      <header className="view-head">
        <h1>Chat</h1>
        <p className="wake">morning session</p>
      </header>
      <div className="messages" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.from}`}>
            <div className="who">{m.from === "riket" ? "> riket" : "< ohm"}</div>
            <pre>{m.text}</pre>
            {m.approvalId && (
              <div className="actions">
                <button onClick={() => resolve(m.approvalId!, "approve")}>approve</button>
                <button className="ghost" onClick={() => resolve(m.approvalId!, "reject")}>reject</button>
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="composer" onSubmit={send}>
        <input
          autoFocus
          aria-label="Message"
          placeholder="type or speak..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !draft.trim()}>send</button>
      </form>
    </section>
  );
}
