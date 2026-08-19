import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const roles = useMemo(() => ["Owner", "Conductor", "Agent"], []);

  const [role, setRole] = useState<(typeof roles)[number]>("Owner");
  const [dbReady, setDbReady] = useState(false);

  const [intent, setIntent] = useState("");
  const [listening, setListening] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [plan, setPlan] = useState<null | {
    intent: string;
    role: string;
    steps: Array<{
      id: string;
      title: string;
      requires_approval: boolean;
      status: string;
    }>;
  }>(null);

  const [audit, setAudit] = useState<
    Array<{
      ts_ms: number;
      role: string;
      action: string;
      payload: string;
      status: string;
    }>
  >([]);

  const [capabilities, setCapabilities] = useState<
    Array<{
      capability: string;
      owner_allowed: boolean;
      conductor_allowed: boolean;
      agent_allowed: boolean;
    }>
  >([]);

  async function nativeSpeak(text: string) {
    try {
      await invoke("native_speak", { text });
    } catch (e) {
      console.warn("TTS unavailable:", e);
    }
  }

  async function refreshInit() {
    await invoke("init_db");
    setDbReady(true);
    const caps = (await invoke("get_capability_matrix")) as typeof capabilities;
    setCapabilities(caps);
  }

  async function refreshAudit() {
    const entries = (await invoke("get_audit_log", { limit: 30 })) as typeof audit;
    setAudit(entries);
  }

  async function runConductor() {
    const intentValue = intent.trim();
    if (!intentValue) return;
    setStatusMsg("Running conductor...");
    try {
      const pResp = (await invoke("conductor_plan", {
        intent: intentValue,
        role,
      })) as NonNullable<typeof plan>;

      setPlan(pResp);
      await refreshAudit();
      const msg = `Got it. I prepared a plan with ${pResp.steps.length} steps. Destructive tools will require approval in future phases.`;
      setStatusMsg(msg);
      await nativeSpeak(msg);
    } catch (e: any) {
      setStatusMsg(`Conductor error: ${e}`);
    }
  }

  useEffect(() => {
    refreshInit()
      .then(() => refreshAudit())
      .then(() => setStatusMsg("Ready. Click 'Speak' or type your intent below."))
      .catch(() => {
        setDbReady(false);
        setStatusMsg("DB init failed — click 'Init DB' to retry.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleListen() {
    if (listening) return;
    setListening(true);
    setStatusMsg("Waiting for input...");
    try {
      const transcript = (await invoke("native_listen")) as string;
      if (transcript) {
        setIntent(transcript);
        setStatusMsg(`Heard: "${transcript}"`);
      } else {
        setStatusMsg("No input received (cancelled or empty).");
      }
    } catch (e: any) {
      setStatusMsg(`Voice input error: ${e}`);
    } finally {
      setListening(false);
    }
  }

  return (
    <main className="container">
      <h1>Life Autopilot — Phase 0</h1>

      {statusMsg && (
        <div
          style={{
            marginTop: 12,
            padding: "8px 14px",
            borderRadius: 8,
            background: "rgba(59,130,246,0.1)",
            border: "1px solid rgba(59,130,246,0.25)",
            fontSize: 13,
            color: "#1e40af",
            textAlign: "left",
            width: "min(720px, 92vw)",
            alignSelf: "center",
          }}
        >
          {statusMsg}
        </div>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as any)}>
            {roles.map((r) => (
              <option value={r} key={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="row" style={{ marginTop: 16, width: "min(720px, 92vw)" }}>
        <button
          type="button"
          onClick={handleListen}
          disabled={listening}
          style={{
            background: listening ? "#3b82f6" : undefined,
            color: listening ? "#fff" : undefined,
            minWidth: 160,
          }}
        >
          {listening ? "⏳ Listening..." : "🎤 Speak"}
        </button>
      </div>

      <div className="row" style={{ marginTop: 10, width: "min(720px, 92vw)" }}>
        <textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="Type your intent here, or click Speak..."
          style={{
            width: "100%",
            minHeight: 90,
            borderRadius: 8,
            border: "1px solid #ccc",
            padding: 12,
            resize: "vertical",
          }}
        />
      </div>

      <div className="row" style={{ marginTop: 12, gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={runConductor}
          disabled={!dbReady || !intent.trim()}
        >
          Run Conductor
        </button>
        <button
          type="button"
          onClick={() => {
            refreshAudit().catch(() => {});
          }}
        >
          Refresh audit
        </button>
        <button
          type="button"
          onClick={() => {
            refreshInit().catch(() => {});
          }}
        >
          Init DB
        </button>
      </div>

      {plan && (
        <div className="row" style={{ marginTop: 16, width: "min(720px, 92vw)" }}>
          <div
            style={{
              textAlign: "left",
              width: "100%",
              border: "1px solid rgba(0,0,0,0.15)",
              borderRadius: 10,
              padding: 12,
              background: "rgba(255,255,255,0.6)",
            }}
          >
            <h2 style={{ margin: 0, fontSize: 16 }}>Conductor plan</h2>
            <p style={{ marginTop: 6, marginBottom: 10, color: "#444" }}>
              Intent: <b>{plan.intent}</b>
            </p>
            <ol style={{ paddingLeft: 18 }}>
              {plan.steps.map((s) => (
                <li key={s.id} style={{ marginBottom: 8 }}>
                  <div>
                    <b>{s.title}</b>
                  </div>
                  <div style={{ fontSize: 12, color: "#555" }}>
                    status: {s.status} · approval required:{" "}
                    {s.requires_approval ? "yes" : "no"}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      <div
        className="row"
        style={{
          marginTop: 16,
          width: "min(920px, 94vw)",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Permission model</h2>
          <div style={{ marginTop: 10 }}>
            {capabilities.length === 0 ? null : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Capability</th>
                    <th>Owner</th>
                    <th>Conductor</th>
                    <th>Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {capabilities.map((c) => (
                    <tr key={c.capability}>
                      <td style={{ padding: "6px 0" }}>{c.capability}</td>
                      <td>{String(c.owner_allowed)}</td>
                      <td>{String(c.conductor_allowed)}</td>
                      <td>{String(c.agent_allowed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Audit log</h2>
          <div
            style={{
              marginTop: 10,
              maxHeight: 260,
              overflow: "auto",
              paddingRight: 8,
            }}
          >
            {audit.length === 0 ? null : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>When</th>
                    <th style={{ textAlign: "left" }}>Role</th>
                    <th style={{ textAlign: "left" }}>Action</th>
                    <th style={{ textAlign: "left" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((e, i) => (
                    <tr
                      key={`${e.ts_ms}-${e.action}-${i}`}
                      style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}
                    >
                      <td style={{ padding: "6px 0", fontSize: 12 }}>
                        {new Date(e.ts_ms).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: "6px 0", fontSize: 12 }}>{e.role}</td>
                      <td style={{ padding: "6px 0", fontSize: 12 }}>
                        {e.action}
                      </td>
                      <td style={{ padding: "6px 0", fontSize: 12 }}>
                        {e.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
