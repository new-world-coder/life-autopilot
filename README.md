# Life Autopilot

A desktop-first personal orchestration platform — voice-driven intent routing, multi-AI coordination, app-to-app data pipelines, and capability-based security. Built with Tauri 2 (Rust + React).

## What it does

- **Voice command center** — speak or type an intent, get a structured plan
- **Conductor** — decomposes tasks, routes to specialist agents (coming soon: Gemini, Claude, Ollama, Cursor SDK)
- **Pipeline engine** — flow data between apps: email → extract → Notion (Phase 3)
- **Desktop tool launcher** — open apps, run shell commands, AppleScript (Phase 3)
- **Capability-based security** — every action gated by role (Owner / Conductor / Agent) with audit log
- **Local-first** — SQLite vault, no cloud required, zero recurring cost

## Current status

**Phase 0** — desktop shell with voice I/O, conductor stub, audit log, and permission scaffold.

## Getting started

```bash
# Prerequisites: Node.js 20+, Rust 1.75+, macOS 13+
npm install
npm run tauri dev
```

## Architecture

```
Tauri Desktop → Voice I/O → Conductor → Security Gate → [Agents, Pipelines, Desktop Tools, Web Navigator]
                                ↓
                          Memory (SQLite) + Scheduler → Notifications
```

Every capability is a plugin with a declared permission scope. The conductor routes intents through the security gate before any tool executes.

## Tech stack

- **Frontend:** React 19 + Vite + TypeScript
- **Backend:** Rust (Tauri 2), rusqlite
- **Voice:** macOS native TTS (`say`), AppleScript input dialog (Phase 0); whisper.cpp planned
- **DB:** SQLite (local, encrypted vault planned)
- **Security:** Capability-based role model, audit log with replay

## Roadmap

| Phase | Focus | Status |
|-------|-------|--------|
| 0 | Desktop shell, voice, audit, permissions | In progress |
| 1 | Gmail, Calendar, daily briefings | Planned |
| 2 | Multi-AI conductor, MCP client | Planned |
| 3 | Pipeline engine, desktop launcher | Planned |
| 4 | Web navigator, fitness, travel, mobile companion | Planned |
| 5 | Security hardening, Keychain vault, sandbox profiles | Planned |

## License

MIT
