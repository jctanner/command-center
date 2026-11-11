use crate::config::Host;
use anyhow::{Context, Result, bail, ensure};
use portable_pty::CommandBuilder;
use std::{io::Write, path::PathBuf, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

#[derive(Clone)]
pub struct Transport {
    pub host: Host,
    pub control_path: PathBuf,
}
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
impl Transport {
    fn jump_config(&self) -> Result<PathBuf> {
        let path = self.control_path.with_extension("ssh-config");
        if path.exists() {
            return Ok(path);
        }
        let home =
            PathBuf::from(std::env::var_os("HOME").context("SSH home directory unavailable")?);
        let includes = if let Some(config) = &self.host.ssh_config {
            let config = if let Some(tail) = config.strip_prefix("~/") {
                home.join(tail)
            } else {
                PathBuf::from(config)
            };
            vec![if config.is_absolute() {
                config
            } else {
                std::env::current_dir()?.join(config)
            }]
        } else {
            vec![
                home.join(".ssh/config"),
                PathBuf::from("/etc/ssh/ssh_config"),
            ]
        };
        let mut text =
            "Host *\n  BatchMode yes\n  StrictHostKeyChecking yes\n  ConnectTimeout 8\n".to_owned();
        for include in includes {
            let value = include
                .to_str()
                .context("SSH configuration path is not UTF-8")?;
            ensure!(
                !value.chars().any(char::is_control),
                "Invalid SSH configuration path"
            );
            text.push_str(&format!(
                "  Include \"{}\"\n",
                value.replace('\\', "\\\\").replace('"', "\\\"")
            ));
        }
        let mut temporary = tempfile::NamedTempFile::new_in(
            path.parent().context("SSH runtime directory unavailable")?,
        )?;
        temporary.write_all(text.as_bytes())?;
        if let Err(error) = temporary.persist_noclobber(&path)
            && error.error.kind() != std::io::ErrorKind::AlreadyExists
        {
            return Err(error.error.into());
        }
        Ok(path)
    }
    fn command_invocation(
        &self,
        program: &str,
        args: Vec<String>,
        terminal: bool,
    ) -> Result<(String, Vec<String>)> {
        let Some(host) = &self.host.ssh else {
            return Ok((program.into(), args));
        };
        let mut ssh: Vec<String> = [
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ConnectTimeout=8",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=2",
            "-o",
            "ControlMaster=auto",
            "-o",
            "ControlPersist=60",
            "-o",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect();
        ssh.push(format!("ControlPath={}", self.control_path.display()));
        if let Some(jump) = &self.host.ssh_jump {
            // -J's subprocess inherits -F, but not the destination's CLI -o
            // flags. Apply noninteractive, strict verification to both hops.
            ssh.extend([
                "-F".into(),
                self.jump_config()?.to_string_lossy().into_owned(),
                "-J".into(),
                jump.clone(),
            ]);
        } else if let Some(path) = &self.host.ssh_config {
            ssh.extend(["-F".into(), path.clone()]);
        }
        if terminal {
            ssh.push("-tt".into());
        }
        ssh.extend([
            "--".into(),
            host.clone(),
            format!(
                "{program} {}",
                args.iter().map(|s| quote(s)).collect::<Vec<_>>().join(" ")
            ),
        ]);
        Ok(("ssh".into(), ssh))
    }
    fn invocation(&self, args: &[&str], terminal: bool) -> Result<(String, Vec<String>)> {
        let mut tmux = vec!["-u".into()];
        if let Some(socket) = &self.host.socket {
            tmux.extend(["-S".into(), socket.clone()]);
        }
        tmux.extend(args.iter().map(|s| (*s).into()));
        self.command_invocation("tmux", tmux, terminal)
    }
    pub async fn run(&self, args: &[&str]) -> Result<String> {
        let (program, argv) = self.invocation(args, false)?;
        let output = tokio::time::timeout(
            Duration::from_secs(12),
            Command::new(&program)
                .args(argv)
                .env_remove("TMUX")
                .env_remove("TMUX_PANE")
                .stdin(Stdio::null())
                .kill_on_drop(true)
                .output(),
        )
        .await
        .context("host command timed out")?
        .with_context(|| format!("running {program}"))?;
        if !output.status.success() {
            bail!("{}", String::from_utf8_lossy(&output.stderr).trim());
        }
        String::from_utf8(output.stdout).context("host returned invalid UTF-8")
    }
    pub(crate) async fn directory_accessible(&self, path: &str) -> Result<bool> {
        // The fixed script consumes a positional argument, never interpolated
        // shell syntax, and works on tmux-only hosts without a Python helper.
        let (program, args) = self.command_invocation(
            "sh",
            vec![
                "-c".into(),
                "test -d \"$1\" && test -x \"$1\"".into(),
                "cc-directory".into(),
                path.into(),
            ],
            false,
        )?;
        let output = tokio::time::timeout(
            Duration::from_secs(12),
            Command::new(program)
                .args(args)
                .env_remove("TMUX")
                .env_remove("TMUX_PANE")
                .stdin(Stdio::null())
                .kill_on_drop(true)
                .output(),
        )
        .await
        .context("directory check timed out")??;
        Ok(output.status.success())
    }
    // No daemon is installed. The SSH helper takes bounded JSON on stdin;
    // filenames/content never become remote shell syntax or command arguments.
    pub(crate) async fn file_request(
        &self,
        request: serde_json::Value,
    ) -> Result<serde_json::Value> {
        self.helper_request(include_str!("filesystem_remote.py"), request)
            .await
    }
    pub(crate) async fn agent_request(
        &self,
        mut request: serde_json::Value,
    ) -> Result<serde_json::Value> {
        request["socket"] = serde_json::json!(self.host.socket);
        self.helper_request(include_str!("agent_remote.py"), request)
            .await
    }
    pub(crate) async fn attachment_request(
        &self,
        mut request: serde_json::Value,
    ) -> Result<serde_json::Value> {
        request["socket"] = serde_json::json!(self.host.socket);
        request["_agent_code"] = serde_json::json!(include_str!("agent_remote.py"));
        request["_attachment_code"] = serde_json::json!(include_str!("attachment_remote.py"));
        self.helper_request(include_str!("attachment_bootstrap.py"), request)
            .await
    }
    pub(crate) async fn slack_request(
        &self,
        project: &str,
        request: serde_json::Value,
    ) -> Result<serde_json::Value> {
        self.helper_request(include_str!("slack_bootstrap.py"), serde_json::json!({"project":project,"code":include_str!("slack_remote.py"),"request":request})).await
    }
    pub(crate) async fn email_request(
        &self,
        project: &str,
        request: serde_json::Value,
    ) -> Result<serde_json::Value> {
        self.helper_request(include_str!("email_bootstrap.py"), serde_json::json!({"project":project,"code":include_str!("email_remote.py"),"request":request})).await
    }
    pub(crate) async fn jira_request(
        &self,
        project: &str,
        request: serde_json::Value,
    ) -> Result<serde_json::Value> {
        self.helper_request(include_str!("jira_bootstrap.py"),serde_json::json!({"project":project,"code":include_str!("jira_remote.py"),"request":request})).await
    }
    async fn helper_request(
        &self,
        script: &str,
        request: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let (program, args) =
            self.command_invocation("python3", vec!["-c".into(), script.into()], false)?;
        tokio::time::timeout(Duration::from_secs(20), async {
            let mut child = Command::new(program)
                .args(args)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .context("starting host helper (requires Python 3)")?;
            let mut input = child.stdin.take().unwrap();
            let body = serde_json::to_vec(&request)?;
            let write = async move {
                input.write_all(&body).await?;
                drop(input);
                Ok::<_, std::io::Error>(())
            };
            let mut stdout = child.stdout.take().unwrap().take(8 * 1024 * 1024 + 1);
            let mut stderr = child.stderr.take().unwrap().take(8193);
            let mut output = Vec::new();
            let mut error = Vec::new();
            let (_, _, _, status) = tokio::try_join!(
                write,
                stdout.read_to_end(&mut output),
                stderr.read_to_end(&mut error),
                child.wait()
            )?;
            ensure!(
                output.len() <= 8 * 1024 * 1024,
                "host helper response exceeded limit"
            );
            if !status.success() {
                bail!(
                    "Host helper failed: {}",
                    String::from_utf8_lossy(&error).trim()
                );
            }
            serde_json::from_slice(&output).context("invalid host helper response")
        })
        .await
        .context("host helper operation timed out")?
    }
    pub fn terminal_command(&self, viewer: &str) -> Result<CommandBuilder> {
        let (program, args) = self.invocation(
            &[
                "attach-session",
                "-t",
                viewer,
                ";",
                "set-option",
                "-t",
                viewer,
                "destroy-unattached",
                "on",
            ],
            true,
        )?;
        let mut command = CommandBuilder::new(program);
        command.args(args);
        command.env("TERM", "xterm-256color");
        command.env_remove("TMUX");
        command.env_remove("TMUX_PANE");
        Ok(command)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_arguments_are_always_quoted() {
        let t = Transport {
            host: Host {
                id: "x".into(),
                name: "x".into(),
                ssh: Some("devbox".into()),
                ssh_config: None,
                ssh_jump: None,
                projects: vec![],
                socket: Some("/tmp/user's socket;touch bad".into()),
            },
            control_path: "/tmp/control".into(),
        };
        let (program, args) = t
            .invocation(&["display-message", "-p", "#{session_id}"], false)
            .unwrap();
        assert_eq!(program, "ssh");
        assert_eq!(
            args.last().unwrap(),
            "tmux '-u' '-S' '/tmp/user'\\''s socket;touch bad' 'display-message' '-p' '#{session_id}'"
        );
        assert!(args.contains(&"StrictHostKeyChecking=yes".into()));
    }
}
