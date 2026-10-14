use std::env;
use std::fs::{self, OpenOptions};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const DEFAULT_PORT: u16 = 8765;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The Python sidecar as a plain child process. No shell, loopback only, no capability exposed to the webview.
pub struct Sidecar {
    child: Option<Child>,
}

fn operator_dir() -> PathBuf {
    env::var_os("OHM_OPERATOR_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")))
}

fn port() -> u16 {
    env::var("OHM_SIDECAR_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(DEFAULT_PORT)
}

fn already_running(port: u16) -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

impl Sidecar {
    pub fn start() -> Self {
        let port = port();
        if already_running(port) {
            eprintln!("sidecar already listening on 127.0.0.1:{port}; not spawning another");
            return Sidecar { child: None };
        }
        let root = operator_dir();
        let runtime = root.join("python-runtime");
        let python = env::var_os("OHM_PYTHON").unwrap_or_else(|| "python".into());
        let log_dir = root.join("data");
        let _ = fs::create_dir_all(&log_dir);
        let log = OpenOptions::new().create(true).append(true).open(log_dir.join("sidecar.log"));
        let (out, err) = match log.and_then(|f| Ok((f.try_clone()?, f))) {
            Ok((a, b)) => (Stdio::from(a), Stdio::from(b)),
            Err(_) => (Stdio::null(), Stdio::null()),
        };
        let mut cmd = Command::new(python);
        cmd.arg(runtime.join("main.py"))
            .arg("--port")
            .arg(port.to_string())
            .current_dir(&runtime)
            .stdin(Stdio::null())
            .stdout(out)
            .stderr(err);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        match cmd.spawn() {
            Ok(child) => Sidecar { child: Some(child) },
            Err(e) => {
                eprintln!("could not start sidecar from {}: {e}", runtime.display());
                Sidecar { child: None }
            }
        }
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.stop();
    }
}
