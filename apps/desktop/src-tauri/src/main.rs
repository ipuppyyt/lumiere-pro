#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;

const HOST_PORT: u16 = 47821;

/// The Node editor host (project store + MCP bridge) when this app started it.
struct HostProcess(Mutex<Option<Child>>);

fn host_is_up() -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], HOST_PORT).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn host_info_path() -> PathBuf {
    let base = std::env::var_os("CE_STATE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default()).join("lumiere-pro")
        });
    base.join("host.json")
}

/// (port, token) from the host's discovery file.
fn read_host_info() -> Option<(u16, String)> {
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(host_info_path()).ok()?).ok()?;
    Some((v["port"].as_u64()? as u16, v["token"].as_str()?.to_owned()))
}

fn quiet(mut cmd: Command) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.stdin(Stdio::null());
    cmd
}

/// Dev: run the TypeScript host from the repo with `node --import tsx`. Fixed argv, no shell.
#[cfg(debug_assertions)]
fn host_command(_app: &tauri::AppHandle) -> Result<Command, String> {
    // apps/desktop/src-tauri -> repo root
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let mut c = Command::new("node");
    c.args(["--import", "tsx", "packages/host/src/main.ts"])
        .current_dir(root);
    Ok(c)
}

/// Release: run the bundled Node runtime on the bundled single-file host. Nothing from the repo is needed.
#[cfg(not(debug_assertions))]
fn host_command(app: &tauri::AppHandle) -> Result<Command, String> {
    let res = app.path().resource_dir().map_err(|e| e.to_string())?;
    // Windows resource paths can carry a \\?\ prefix that node's path handling does not like.
    let res = PathBuf::from(res.to_string_lossy().trim_start_matches(r"\\?\"));
    let node = res.join("node").join("node.exe");
    let host = res.join("host").join("host.mjs");
    if !node.exists() || !host.exists() {
        return Err(format!(
            "bundled runtime is missing under {}",
            res.display()
        ));
    }
    let mut c = Command::new(node);
    c.arg(host)
        .env("CE_UI_DIR", res.join("ui"))
        .current_dir(&res);
    let ffprobe = res.join("ffmpeg").join("ffprobe.exe");
    if ffprobe.exists() {
        c.env("CE_FFPROBE", ffprobe);
    }
    Ok(c)
}

/// Starts the host unless one is already listening.
fn spawn_host(app: &tauri::AppHandle) -> Result<Option<Child>, String> {
    if host_is_up() {
        eprintln!("[tauri] editor host already running; reusing it");
        return Ok(None);
    }
    let _ = std::fs::remove_file(host_info_path()); // never trust a stale token from a crashed run
    let child = quiet(host_command(app)?)
        .spawn()
        .map_err(|e| format!("could not start the editor host: {e}"))?;
    eprintln!("[tauri] started editor host (pid {})", child.id());
    Ok(Some(child))
}

fn wait_for_host(timeout: Duration) -> Option<(u16, String)> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if host_is_up() {
            if let Some(info) = read_host_info() {
                return Some(info);
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    None
}

/// Native "open video" dialog. Returns an absolute path or None if cancelled.
/// The host re-validates the path; this only chooses it.
#[tauri::command]
async fn pick_media_file(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("Video", &["mp4", "mov", "mkv", "webm", "avi", "m4v"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
async fn pick_project_file(app: tauri::AppHandle, save: bool) -> Option<String> {
    let builder = app
        .dialog()
        .file()
        .add_filter("Lumiere Pro project", &["json"]);
    let picked = if save {
        builder
            .set_file_name("project.lumiere.json")
            .blocking_save_file()
    } else {
        builder.blocking_pick_file()
    };
    picked
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

fn fatal(app: &tauri::AppHandle, msg: &str) {
    eprintln!("[tauri] {msg}");
    app.dialog()
        .message(msg.to_owned())
        .title("Lumiere Pro")
        .blocking_show();
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(HostProcess(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            match spawn_host(&handle) {
                Ok(child) => *app.state::<HostProcess>().0.lock().unwrap() = child,
                Err(e) => {
                    fatal(&handle, &e);
                    std::process::exit(1);
                }
            }

            // Release builds have no dev server: the window loads the UI the host serves, and
            // receives the host's token through an init script (never in a URL).
            #[cfg(not(debug_assertions))]
            {
                let Some((port, token)) = wait_for_host(Duration::from_secs(20)) else {
                    fatal(
                        &handle,
                        "The editor host did not start. Check that port 47821 is free.",
                    );
                    std::process::exit(1);
                };
                let url: tauri::Url = format!("http://127.0.0.1:{port}/").parse().unwrap();
                let script = format!(
                    "window.__CE_TOKEN__ = {};",
                    serde_json::to_string(&token).unwrap()
                );
                tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url))
                    .title("Lumiere Pro")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(900.0, 600.0)
                    .initialization_script(&script)
                    .build()?;
            }
            #[cfg(debug_assertions)]
            let _ = wait_for_host; // dev: window comes from tauri.conf.json and the Vite proxy supplies auth

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![pick_media_file, pick_project_file])
        .build(tauri::generate_context!())
        .expect("error while building Lumiere Pro");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = handle.state::<HostProcess>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
