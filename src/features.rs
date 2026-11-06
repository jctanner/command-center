//! Installation-wide availability switches; source permissions remain independent.
use crate::{ApiError, AppState};
use axum::{
    Json,
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::Response,
};
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::sync::RwLock;

#[derive(Clone, Copy, Default, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Flags {
    pub slack: bool,
    pub email: bool,
    pub jira: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Settings {
    pub revision: String,
    pub features: Flags,
}
pub(crate) struct Features {
    pub settings: RwLock<Settings>,
    path: Option<PathBuf>,
}
#[derive(Clone, Copy)]
pub(crate) enum Feature {
    Slack,
    Email,
    Jira,
}
impl Feature {
    fn enabled(self, f: Flags) -> bool {
        match self {
            Self::Slack => f.slack,
            Self::Email => f.email,
            Self::Jira => f.jira,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Slack => "Slack",
            Self::Email => "Email",
            Self::Jira => "Jira",
        }
    }
}
fn persist(path: &Path, value: &Settings) -> anyhow::Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    file.write_all(&serde_json::to_vec(value)?)?;
    file.as_file().sync_all()?;
    file.persist(path)?;
    std::fs::File::open(parent)?.sync_all()?;
    Ok(())
}
impl Features {
    pub fn new(config: Option<&Path>) -> anyhow::Result<Self> {
        let path = config.map(|p| p.with_extension("features.json"));
        let settings = if let Some(p) = path.as_ref().filter(|p| p.exists()) {
            serde_json::from_slice::<Settings>(&std::fs::read(p)?)?
        } else {
            let configured = |name: &str| -> anyhow::Result<bool> {
                let Some(p) = config
                    .map(|p| p.with_extension(format!("{name}.json")))
                    .filter(|p| p.exists())
                else {
                    return Ok(false);
                };
                let value: serde_json::Value = serde_json::from_slice(&std::fs::read(p)?)?;
                Ok(value
                    .get("source")
                    .is_some_and(serde_json::Value::is_object))
            };
            let value = Settings {
                revision: uuid::Uuid::new_v4().to_string(),
                features: Flags {
                    slack: configured("slack")?,
                    email: configured("email")?,
                    jira: configured("jira")?,
                },
            };
            if let Some(p) = &path {
                persist(p, &value)?;
            }
            value
        };
        anyhow::ensure!(
            uuid::Uuid::parse_str(&settings.revision).is_ok(),
            "Invalid feature settings revision"
        );
        Ok(Self {
            settings: RwLock::new(settings),
            path,
        })
    }
}
pub(crate) async fn get(
    State(s): State<Arc<AppState>>,
) -> ([(header::HeaderName, &'static str); 1], Json<Settings>) {
    (
        [(header::CACHE_CONTROL, "private, no-store")],
        Json(s.features.settings.read().await.clone()),
    )
}
pub(crate) async fn save(
    State(s): State<Arc<AppState>>,
    Json(mut value): Json<Settings>,
) -> Result<Json<Settings>, ApiError> {
    // Holding the write lock waits for active guarded requests to finish. Once
    // disable commits, newly arriving requests cannot execute integration IO.
    let mut current = s.features.settings.write().await;
    if current.revision != value.revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Features changed in another client. Reload saved settings before trying again.".into(),
        ));
    }
    let path = s.features.path.clone().ok_or_else(|| {
        ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "Start CC with a configuration file to save feature settings".into(),
        )
    })?;
    let expected = current.revision.clone();
    value.revision = uuid::Uuid::new_v4().to_string();
    let saved = value.clone();
    tokio::task::spawn_blocking(move || -> Result<(), ApiError> {
        let disk: Settings =
            serde_json::from_slice(&std::fs::read(&path).map_err(anyhow::Error::from)?)
                .map_err(anyhow::Error::from)?;
        if disk.revision != expected {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Feature settings changed on disk; restart CC to reload them".into(),
            ));
        }
        persist(&path, &saved).map_err(|_| {
            ApiError(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Feature settings could not be saved; previous flags remain active".into(),
            )
        })
    })
    .await
    .map_err(anyhow::Error::from)??;
    *current = value.clone();
    Ok(Json(value))
}
pub(crate) async fn gate(
    State((s, feature)): State<(Arc<AppState>, Feature)>,
    request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let flags = s.features.settings.read().await;
    if !feature.enabled(flags.features) {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            format!(
                "{} is disabled. Enable it in Settings > Features.",
                feature.name()
            ),
        ));
    }
    let response = next.run(request).await;
    drop(flags);
    Ok(response)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fresh_defaults_off_and_legacy_sources_migrate_only_once() {
        let d = tempfile::tempdir().unwrap();
        let config = d.path().join("config.toml");
        let fresh = Features::new(Some(&config)).unwrap();
        assert_eq!(
            fresh.settings.try_read().unwrap().features,
            Flags::default()
        );
        std::fs::remove_file(config.with_extension("features.json")).unwrap();
        std::fs::write(
            config.with_extension("slack.json"),
            r#"{"source":{"host":"fixture","project":"/fixture"}}"#,
        )
        .unwrap();
        let migrated = Features::new(Some(&config)).unwrap();
        assert!(migrated.settings.try_read().unwrap().features.slack);
        let disabled = Settings {
            revision: uuid::Uuid::new_v4().to_string(),
            features: Flags::default(),
        };
        persist(&config.with_extension("features.json"), &disabled).unwrap();
        let restarted = Features::new(Some(&config)).unwrap();
        assert_eq!(
            restarted.settings.try_read().unwrap().features,
            Flags::default()
        );
    }
    #[tokio::test]
    async fn disabling_waits_for_active_handlers_and_blocks_subsequent_requests() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config.toml");
        let state = AppState::with_config(
            crate::config::Config { hosts: vec![] },
            8080,
            Some(config.clone()),
        )
        .unwrap();
        let mut enabled = state.features.settings.read().await.clone();
        enabled.features.slack = true;
        let enabled = save(State(state.clone()), Json(enabled)).await.unwrap();
        assert!(enabled.features.slack);
        let started = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let handler_started = started.clone();
        let handler_release = release.clone();
        let app = axum::Router::new()
            .route(
                "/probe",
                axum::routing::get(move || {
                    let started = handler_started.clone();
                    let release = handler_release.clone();
                    async move {
                        started.notify_one();
                        release.notified().await;
                        "ok"
                    }
                }),
            )
            .layer(axum::middleware::from_fn_with_state(
                (state.clone(), Feature::Slack),
                gate,
            ));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let request = move || async move {
            let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
            stream
                .write_all(b"GET /probe HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .await
                .unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).await.unwrap();
            response
        };
        let active = tokio::spawn(request());
        tokio::time::timeout(std::time::Duration::from_secs(2), started.notified())
            .await
            .unwrap();
        let mut disabled = state.features.settings.read().await.clone();
        disabled.features.slack = false;
        let mut saving = tokio::spawn(save(State(state.clone()), Json(disabled)));
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut saving)
                .await
                .is_err()
        );
        let disk: Settings =
            serde_json::from_slice(&std::fs::read(config.with_extension("features.json")).unwrap())
                .unwrap();
        assert!(disk.features.slack);
        release.notify_one();
        assert!(active.await.unwrap().starts_with("HTTP/1.1 200"));
        assert!(!saving.await.unwrap().unwrap().features.slack);
        assert!(request().await.starts_with("HTTP/1.1 403"));
        server.abort();
    }
    #[test]
    fn no_config_has_disabled_in_memory_defaults() {
        assert_eq!(
            Features::new(None)
                .unwrap()
                .settings
                .try_read()
                .unwrap()
                .features,
            Flags::default()
        );
    }
}
