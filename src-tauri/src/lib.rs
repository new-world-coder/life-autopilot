// Phase 0: local-first conductor, audit log, capability scaffold, native voice I/O.

use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::Serialize;

fn db_conn() -> Result<Connection, String> {
    // Phase 0 local-first: keep DB in the app's current working directory so we can
    // ship quickly without needing an app-data-dir API surface.
    let path = std::env::current_dir()
        .ok()
        .map(|p| p.join("life-autopilot.sqlite"))
        .unwrap_or_else(|| std::path::PathBuf::from("life-autopilot.sqlite"));

    Connection::open(path).map_err(|e| format!("db open failed: {e}"))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Serialize)]
pub struct ConductorPlanStep {
    pub id: String,
    pub title: String,
    pub requires_approval: bool,
    pub status: String,
}

#[derive(Serialize)]
pub struct ConductorPlan {
    pub intent: String,
    pub role: String,
    pub steps: Vec<ConductorPlanStep>,
}

#[derive(Serialize)]
pub struct AuditLogEntry {
    pub ts_ms: i64,
    pub role: String,
    pub action: String,
    pub payload: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct CapabilityRow {
    pub capability: String,
    pub owner_allowed: bool,
    pub conductor_allowed: bool,
    pub agent_allowed: bool,
}

#[tauri::command]
fn init_db() -> Result<(), String> {
    let conn = db_conn()?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts_ms INTEGER NOT NULL,
          role TEXT NOT NULL,
          action TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS capabilities (
          id TEXT PRIMARY KEY,
          capability TEXT NOT NULL,
          owner_allowed INTEGER NOT NULL,
          conductor_allowed INTEGER NOT NULL,
          agent_allowed INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| format!("db init failed: {e}"))?;

    // Seed a minimal capability set so the UI can render the permission model.
    // Phase 5 will turn this into enforced scoped privileges.
    conn.execute(
        r#"INSERT OR IGNORE INTO capabilities (id, capability, owner_allowed, conductor_allowed, agent_allowed)
           VALUES (?1, ?2, 1, 1, 0)"#,
        params!["cap_conductor_plan", "conductor:plan",],
    )
    .map_err(|e| format!("seed capabilities failed: {e}"))?;

    conn.execute(
        r#"INSERT OR IGNORE INTO capabilities (id, capability, owner_allowed, conductor_allowed, agent_allowed)
           VALUES (?1, ?2, 1, 0, 0)"#,
        params!["cap_execute_tools", "tools:execute_destructive",],
    )
    .map_err(|e| format!("seed capabilities failed: {e}"))?;

    Ok(())
}

#[tauri::command]
fn get_capability_matrix() -> Result<Vec<CapabilityRow>, String> {
    let conn = db_conn()?;
    let mut stmt = conn
        .prepare(
            r#"SELECT capability, owner_allowed, conductor_allowed, agent_allowed
               FROM capabilities
               ORDER BY capability"#,
        )
        .map_err(|e| format!("capabilities query failed: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(CapabilityRow {
                capability: row.get(0)?,
                owner_allowed: row.get::<_, i64>(1)? == 1,
                conductor_allowed: row.get::<_, i64>(2)? == 1,
                agent_allowed: row.get::<_, i64>(3)? == 1,
            })
        })
        .map_err(|e| format!("capabilities map failed: {e}"))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("capabilities row failed: {e}"))?);
    }
    Ok(out)
}

#[tauri::command]
fn conductor_plan(intent: String, role: String) -> Result<ConductorPlan, String> {
    let role = role.trim().to_string();
    let role_norm = if role.is_empty() { "Owner".to_string() } else { role };

    // Phase 0: stub plan generation (no real tool execution yet).
    let steps = vec![
        ConductorPlanStep {
            id: "parse_intent".to_string(),
            title: "Parse intent into structured sub-tasks".to_string(),
            requires_approval: false,
            status: "planned".to_string(),
        },
        ConductorPlanStep {
            id: "plan_merge".to_string(),
            title: "Return a merged plan (no tools executed yet)".to_string(),
            requires_approval: false,
            status: "planned".to_string(),
        },
        ConductorPlanStep {
            id: "future_execute".to_string(),
            title: "Execute tools (gated in Phase 5)".to_string(),
            requires_approval: role_norm != "Owner",
            status: "blocked_by_phase0".to_string(),
        },
    ];

    let conn = db_conn()?;
    let payload = serde_json::json!({ "intent": intent, "role": role_norm });
    conn.execute(
        r#"INSERT INTO audit_log (ts_ms, role, action, payload, status)
           VALUES (?1, ?2, ?3, ?4, ?5)"#,
        params![
            now_ms(),
            &role_norm,
            "conductor_plan",
            payload.to_string(),
            "ok"
        ],
    )
    .map_err(|e| format!("audit insert failed: {e}"))?;

    Ok(ConductorPlan {
        intent: payload["intent"].as_str().unwrap_or_default().to_string(),
        role: role_norm,
        steps,
    })
}

#[tauri::command]
fn get_audit_log(limit: usize) -> Result<Vec<AuditLogEntry>, String> {
    let conn = db_conn()?;
    let lim = limit.min(200);
    let mut stmt = conn
        .prepare(
            r#"SELECT ts_ms, role, action, payload, status
               FROM audit_log
               ORDER BY id DESC
               LIMIT ?1"#,
        )
        .map_err(|e| format!("audit log prepare failed: {e}"))?;

    let rows = stmt
        .query_map([lim as i64], |row| {
            Ok(AuditLogEntry {
                ts_ms: row.get(0)?,
                role: row.get(1)?,
                action: row.get(2)?,
                payload: row.get(3)?,
                status: row.get(4)?,
            })
        })
        .map_err(|e| format!("audit log map failed: {e}"))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("audit row failed: {e}"))?);
    }
    Ok(out)
}

/// Use macOS `say` to speak text aloud. Works natively in Tauri (no browser API needed).
#[tauri::command]
fn native_speak(text: String) -> Result<(), String> {
    Command::new("say")
        .arg(&text)
        .spawn()
        .map_err(|e| format!("native_speak failed: {e}"))?;
    Ok(())
}

/// Use macOS dictation via AppleScript to capture speech input.
/// Opens a native dialog, waits for the user to speak, returns the transcript.
#[tauri::command]
fn native_listen() -> Result<String, String> {
    let script = r#"
        tell application "System Events"
            set userText to text returned of (display dialog "Speak your intent:" default answer "" with title "Life Autopilot — Voice Input" buttons {"Cancel", "OK"} default button "OK")
        end tell
        return userText
    "#;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("native_listen spawn failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("User canceled") || stderr.contains("-128") {
            return Ok(String::new());
        }
        return Err(format!("native_listen failed: {}", stderr.trim()));
    }

    let transcript = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(transcript)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            init_db,
            get_capability_matrix,
            conductor_plan,
            get_audit_log,
            native_speak,
            native_listen
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
