use crate::{
    ApiError,
    config::{Config, Host},
    tmux,
    transport::Transport,
};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};
use tokio::sync::{Mutex, RwLock, watch};

pub struct Machine {
    pub config: Host,
    pub transport: Arc<Transport>,
    pub connection_revision: String,
    pub inventory: Mutex<Option<(Instant, tmux::Inventory)>>,
    pub file_writes: Arc<Mutex<()>>,
}
impl Machine {
    fn new(config: Host, runtime: &Path) -> Arc<Self> {
        let token = uuid::Uuid::new_v4().simple().to_string();
        Arc::new(Self {
            transport: Arc::new(Transport {
                host: config.clone(),
                control_path: runtime.join(&token),
            }),
            config,
            connection_revision: token,
            inventory: Mutex::new(None),
            file_writes: Arc::new(Mutex::new(())),
        })
    }
}

#[derive(Clone, Serialize)]
pub struct Summary {
    pub id: String,
    pub name: String,
    pub remote: bool,
    pub connection_revision: String,
}
#[derive(Clone, Serialize)]
pub struct HostList {
    pub revision: String,
    pub hosts: Vec<Summary>,
}
#[derive(Debug, Serialize)]
pub struct Settings {
    pub revision: String,
    pub hosts: Vec<Host>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Draft {
    pub name: String,
    pub ssh: Option<String>,
    pub socket: Option<String>,
    pub ssh_config: Option<String>,
    pub ssh_jump: Option<String>,
}
impl Draft {
    pub fn host(self, id: String) -> Result<Host, ApiError> {
        let host = Host {
            id,
            name: self.name.trim().into(),
            ssh: self.ssh,
            socket: self.socket,
            ssh_config: self.ssh_config,
            ssh_jump: self.ssh_jump,
            projects: vec![],
        };
        host.validate()
            .map_err(|e| ApiError(StatusCode::BAD_REQUEST, e.to_string()))?;
        Ok(host)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Edit {
    pub revision: String,
    pub host: Draft,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Remove {
    pub revision: String,
}
pub enum Change {
    Add(Host),
    Update(Host),
    Remove(String),
}
struct Snapshot {
    revision: String,
    machines: Vec<Arc<Machine>>,
    file_bytes: Option<Vec<u8>>,
}
impl Snapshot {
    fn settings(&self) -> Settings {
        Settings {
            revision: self.revision.clone(),
            hosts: self.machines.iter().map(|h| h.config.clone()).collect(),
        }
    }
    fn list(&self) -> HostList {
        HostList {
            revision: self.revision.clone(),
            hosts: self
                .machines
                .iter()
                .map(|m| Summary {
                    id: m.config.id.clone(),
                    name: m.config.name.clone(),
                    remote: m.config.ssh.is_some(),
                    connection_revision: m.connection_revision.clone(),
                })
                .collect(),
        }
    }
}
pub struct Registry {
    current: RwLock<Snapshot>,
    edits: Mutex<()>,
    path: Option<PathBuf>,
    runtime: PathBuf,
    pub events: watch::Sender<HostList>,
}
impl Registry {
    pub fn new(config: Config, path: Option<PathBuf>, runtime: &Path) -> anyhow::Result<Self> {
        config.validate()?;
        let file_bytes = match &path {
            Some(p) => read_optional(p)?,
            None => None,
        };
        let snapshot = Snapshot {
            revision: uuid::Uuid::new_v4().to_string(),
            machines: config
                .hosts
                .into_iter()
                .map(|h| Machine::new(h, runtime))
                .collect(),
            file_bytes,
        };
        let (events, _) = watch::channel(snapshot.list());
        Ok(Self {
            current: RwLock::new(snapshot),
            edits: Mutex::new(()),
            path,
            runtime: runtime.into(),
            events,
        })
    }
    pub async fn list(&self) -> HostList {
        self.current.read().await.list()
    }
    pub async fn settings(&self) -> Settings {
        self.current.read().await.settings()
    }
    pub async fn get(&self, id: &str) -> Result<Arc<Machine>, ApiError> {
        self.current
            .read()
            .await
            .machines
            .iter()
            .find(|h| h.config.id == id)
            .cloned()
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "unknown machine".into()))
    }
    pub async fn apply(&self, revision: &str, change: Change) -> Result<Settings, ApiError> {
        let _edit = self.edits.lock().await;
        // Endpoint edits/removal cannot race a guarded file write or agent send.
        let _connection = match &change {
            Change::Update(host) => Some(
                self.get(&host.id)
                    .await?
                    .file_writes
                    .clone()
                    .lock_owned()
                    .await,
            ),
            Change::Remove(id) => Some(self.get(id).await?.file_writes.clone().lock_owned().await),
            Change::Add(_) => None,
        };
        let previous = self.current.read().await;
        if previous.revision != revision {
            return Err(ApiError(StatusCode::CONFLICT, "Machines changed in another browser. Reload the machine list and try again; your draft has been kept.".into()));
        }
        let mut machines = previous.machines.clone();
        match change {
            Change::Add(host) => {
                if machines.iter().any(|h| h.config.id == host.id) {
                    return Err(ApiError(
                        StatusCode::CONFLICT,
                        "machine id already exists".into(),
                    ));
                }
                machines.push(Machine::new(host, &self.runtime));
            }
            Change::Update(host) => {
                let index = machines
                    .iter()
                    .position(|h| h.config.id == host.id)
                    .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "machine was removed".into()))?;
                let old = &machines[index];
                let same_connection = old.config.ssh == host.ssh
                    && old.config.socket == host.socket
                    && old.config.ssh_config == host.ssh_config
                    && old.config.ssh_jump == host.ssh_jump;
                machines[index] = if same_connection {
                    Arc::new(Machine {
                        config: host,
                        transport: old.transport.clone(),
                        connection_revision: old.connection_revision.clone(),
                        inventory: Mutex::new(None),
                        file_writes: old.file_writes.clone(),
                    })
                } else {
                    Machine::new(host, &self.runtime)
                };
            }
            Change::Remove(id) => {
                let index = machines
                    .iter()
                    .position(|h| h.config.id == id)
                    .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "machine was removed".into()))?;
                machines.remove(index);
            }
        }
        let config = Config {
            hosts: machines.iter().map(|h| h.config.clone()).collect(),
        };
        config
            .validate()
            .map_err(|e| ApiError(StatusCode::BAD_REQUEST, e.to_string()))?;
        let bytes = toml::to_string_pretty(&config)
            .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .into_bytes();
        let expected = previous.file_bytes.clone();
        drop(previous);
        if let Some(path) = self.path.clone() {
            let output = bytes.clone();
            tokio::task::spawn_blocking(move || persist(&path, expected.as_deref(), &output))
                .await
                .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))??;
        } else {
            return Err(ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "machine settings have no configuration file".into(),
            ));
        }
        let next = Snapshot {
            revision: uuid::Uuid::new_v4().to_string(),
            machines,
            file_bytes: Some(bytes),
        };
        let settings = next.settings();
        let list = next.list();
        *self.current.write().await = next;
        self.events.send_replace(list);
        Ok(settings)
    }
}
fn read_optional(path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}
fn persist(path: &Path, expected: Option<&[u8]>, bytes: &[u8]) -> Result<(), ApiError> {
    let save = || -> Result<(), ApiError> {
        if read_optional(path).map_err(storage_error)?.as_deref() != expected {
            return Err(ApiError(StatusCode::CONFLICT, "Configuration was edited outside Command Center. Restart with that file before saving; your draft has been kept.".into()));
        }
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(storage_error)?;
        file.write_all(bytes).map_err(storage_error)?;
        file.as_file().sync_all().map_err(storage_error)?;
        file.persist(path).map_err(|e| storage_error(e.error))?;
        Ok(())
    };
    save()
}
fn storage_error(error: std::io::Error) -> ApiError {
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("Could not save machine configuration: {error}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Registry) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let config = Config::load(None).unwrap();
        std::fs::write(&path, toml::to_string(&config).unwrap()).unwrap();
        let registry = Registry::new(config, Some(path), dir.path()).unwrap();
        (dir, registry)
    }
    #[tokio::test]
    async fn endpoint_removal_waits_for_guarded_writes_or_sends() {
        let (_dir, registry) = fixture();
        let machine = registry.get("local").await.unwrap();
        let guard = machine.file_writes.lock().await;
        let revision = registry.settings().await.revision;
        let edit = registry.apply(&revision, Change::Remove("local".into()));
        tokio::pin!(edit);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(30), &mut edit)
                .await
                .is_err()
        );
        assert!(registry.get("local").await.is_ok());
        drop(guard);
        edit.await.unwrap();
        assert!(registry.get("local").await.is_err());
    }
    #[tokio::test]
    async fn aliases_persist_and_reuse_the_live_transport() {
        let (dir, registry) = fixture();
        let before = registry.get("local").await.unwrap();
        let revision = registry.settings().await.revision;
        let mut host = before.config.clone();
        host.name = "Renamed".into();
        let saved = registry
            .apply(&revision, Change::Update(host))
            .await
            .unwrap();
        let after = registry.get("local").await.unwrap();
        assert!(Arc::ptr_eq(&before.transport, &after.transport));
        assert_eq!(before.connection_revision, after.connection_revision);
        assert_eq!(
            Config::load(Some(&dir.path().join("config.toml")))
                .unwrap()
                .hosts[0]
                .name,
            "Renamed"
        );
        assert_eq!(registry.events.borrow().revision, saved.revision);
        assert_eq!(
            registry
                .apply(&revision, Change::Remove("local".into()))
                .await
                .unwrap_err()
                .0,
            StatusCode::CONFLICT
        );
    }
    #[tokio::test]
    async fn connection_changes_get_fresh_transports_and_removal_keeps_existing_handles() {
        let (_dir, registry) = fixture();
        let old = registry.get("local").await.unwrap();
        let mut host = old.config.clone();
        host.socket = Some("/tmp/another-socket".into());
        let revision = registry.settings().await.revision;
        let saved = registry
            .apply(&revision, Change::Update(host))
            .await
            .unwrap();
        let next = registry.get("local").await.unwrap();
        assert!(!Arc::ptr_eq(&old.transport, &next.transport));
        assert_ne!(old.connection_revision, next.connection_revision);
        let empty = registry
            .apply(&saved.revision, Change::Remove("local".into()))
            .await
            .unwrap();
        assert!(empty.hosts.is_empty());
        assert_eq!(old.transport.host.id, "local");
        assert_eq!(
            next.transport.host.socket.as_deref(),
            Some("/tmp/another-socket")
        );
    }
    #[tokio::test]
    async fn external_edits_are_not_overwritten_or_published() {
        let (dir, registry) = fixture();
        let before = registry.settings().await;
        let path = dir.path().join("config.toml");
        let external = b"# a manual edit\nhosts = []\n";
        std::fs::write(&path, external).unwrap();
        assert_eq!(
            registry
                .apply(&before.revision, Change::Remove("local".into()))
                .await
                .unwrap_err()
                .0,
            StatusCode::CONFLICT
        );
        assert_eq!(std::fs::read(path).unwrap(), external);
        assert_eq!(registry.settings().await.revision, before.revision);
        assert_eq!(registry.events.borrow().revision, before.revision);
    }
    #[tokio::test]
    async fn failed_save_leaves_live_settings_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let registry = Registry::new(
            Config::load(None).unwrap(),
            Some(dir.path().join("missing/config.toml")),
            dir.path(),
        )
        .unwrap();
        let before = registry.settings().await;
        assert_eq!(
            registry
                .apply(&before.revision, Change::Remove("local".into()))
                .await
                .unwrap_err()
                .0,
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(registry.settings().await.hosts.len(), 1);
        assert_eq!(registry.events.borrow().revision, before.revision);
    }
}
