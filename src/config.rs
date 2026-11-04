use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::Path};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Host {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub projects: Vec<ProjectPin>,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub socket: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_config: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_jump: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectPin {
    pub path: String,
    pub name: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub hosts: Vec<Host>,
}

impl Config {
    pub fn load(path: Option<&Path>) -> Result<Self> {
        let config = match path {
            Some(path) => toml::from_str(
                &std::fs::read_to_string(path)
                    .with_context(|| format!("reading {}", path.display()))?,
            )?,
            None => Self {
                hosts: vec![Host {
                    id: "local".into(),
                    name: "This machine".into(),
                    ssh: None,
                    socket: None,
                    ssh_config: None,
                    ssh_jump: None,
                    projects: vec![],
                }],
            },
        };
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(self.hosts.len() <= 64, "at most 64 machines are supported");
        let mut ids = HashSet::new();
        for host in &self.hosts {
            host.validate()?;
            ensure!(ids.insert(&host.id), "duplicate host id: {}", host.id);
        }
        Ok(())
    }
}

impl Host {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.projects.len() <= 128,
            "at most 128 pinned projects per machine"
        );
        let mut paths = HashSet::new();
        for project in &self.projects {
            ensure!(
                Path::new(&project.path).is_absolute()
                    && !project.path.contains('\0')
                    && project.path.len() <= 4096,
                "project paths must be absolute"
            );
            ensure!(
                !project.name.trim().is_empty()
                    && project.name.chars().count() <= 120
                    && !project.name.chars().any(char::is_control),
                "invalid project name"
            );
            ensure!(paths.insert(&project.path), "duplicate pinned project path");
        }

        ensure!(
            !self.id.is_empty()
                && self.id.len() <= 80
                && self
                    .id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c)),
            "invalid machine id"
        );
        ensure!(
            !self.name.trim().is_empty()
                && self.name.chars().count() <= 120
                && !self.name.chars().any(char::is_control),
            "machine name must be 1–120 characters without control characters"
        );
        if let Some(ssh) = &self.ssh {
            ensure!(
                !ssh.is_empty()
                    && ssh.len() <= 255
                    && !ssh.starts_with('-')
                    && !ssh.chars().any(|c| c.is_whitespace() || c.is_control()),
                "SSH destination must be an OpenSSH alias or user@host, not a command"
            );
        }
        if let Some(jump) = &self.ssh_jump {
            ensure!(
                self.ssh.is_some(),
                "A jump host requires an SSH destination"
            );
            ensure!(
                !jump.is_empty()
                    && jump.len() <= 255
                    && !jump.starts_with('-')
                    && jump
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"._-@:[]".contains(&c)),
                "Jump host must be an SSH alias or [user@]host[:port], not a command"
            );
            ensure!(
                self.ssh.as_ref().is_some_and(|destination| destination
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._-@:[]".contains(&c))),
                "SSH destination must be a literal alias or user@host when using a jump host"
            );
            ensure!(
                self.ssh_config
                    .as_ref()
                    .is_none_or(|p| !p.chars().any(char::is_control)),
                "Invalid SSH configuration path"
            );
        }
        for path in [&self.socket, &self.ssh_config].into_iter().flatten() {
            ensure!(
                !path.is_empty() && path.len() <= 4096 && !path.contains('\0'),
                "invalid socket or SSH configuration path"
            );
        }
        ensure!(
            self.ssh.is_some() || self.ssh_config.is_none(),
            "SSH configuration requires an SSH destination"
        );
        Ok(())
    }
}

#[cfg(test)]
mod jump_tests {
    use super::*;
    #[test]
    fn jump_routes_are_optional_literals_and_require_ssh() {
        let direct: Host = serde_json::from_value(
            serde_json::json!({"id":"test","name":"Test","ssh":"user@target"}),
        )
        .unwrap();
        assert!(direct.validate().is_ok());
        assert!(direct.ssh_jump.is_none());
        for jump in [
            "user@jump",
            "jump-alias",
            "user@192.0.2.1:2222",
            "user@[::1]:2222",
        ] {
            let mut host = direct.clone();
            host.ssh_jump = Some(jump.into());
            assert!(host.validate().is_ok());
        }
        for jump in [
            "-oProxyCommand=bad",
            "jump;touch",
            "jump host",
            "$(command)",
            "jump\nHost *",
            "jump%h",
        ] {
            let mut host = direct.clone();
            host.ssh_jump = Some(jump.into());
            assert!(host.validate().is_err());
        }
        let mut host = direct;
        host.ssh_jump = Some("jump".into());
        host.ssh = None;
        assert!(host.validate().is_err());
    }
}
