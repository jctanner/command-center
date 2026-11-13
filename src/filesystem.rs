use crate::{ApiError, AppState, config::ProjectPin, machines, tmux};
use axum::{
    Json,
    extract::{Path as HostPath, Query, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, Metadata, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
const LIMIT: usize = 1024 * 1024;
fn error(status: StatusCode, message: impl Into<String>) -> ApiError {
    ApiError(status, message.into())
}
fn io(error_value: std::io::Error) -> ApiError {
    let status = match error_value.kind() {
        std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        std::io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
        _ => StatusCode::BAD_REQUEST,
    };
    error(status, error_value.to_string())
}
fn resolve(value: &str) -> Result<PathBuf, ApiError> {
    if value.is_empty() || value.len() > 4096 || value.contains('\0') {
        return Err(error(StatusCode::BAD_REQUEST, "Invalid path"));
    }
    let path = if value == "~" || value.starts_with("~/") {
        let home = std::env::var_os("HOME")
            .ok_or_else(|| error(StatusCode::BAD_REQUEST, "Home directory unavailable"))?;
        PathBuf::from(home).join(value.strip_prefix("~/").unwrap_or(""))
    } else {
        PathBuf::from(value)
    };
    if !path.is_absolute() {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "Use an absolute path or ~/path",
        ));
    }
    fs::canonicalize(path).map_err(io)
}
fn utf8(path: &Path) -> Result<&str, ApiError> {
    path.to_str().ok_or_else(|| {
        error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Non-UTF-8 paths are unsupported",
        )
    })
}
fn readonly(meta: &Metadata) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.nlink() > 1 {
            return Some("Hard-linked files are read-only in this editor".into());
        }
        // SAFETY: geteuid has no preconditions and does not mutate process state.
        if meta.uid() != unsafe { libc::geteuid() } {
            return Some("Saving would change file ownership".into());
        }
    }
    meta.permissions()
        .readonly()
        .then(|| "File is read-only".into())
}
fn version(meta: &Metadata, data: &[u8]) -> String {
    let hash = format!("{:x}", Sha256::digest(data));
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        format!(
            "{}:{}:{}:{}:{}:{}:{hash}",
            meta.dev(),
            meta.ino(),
            meta.mode(),
            meta.nlink(),
            meta.ctime(),
            meta.ctime_nsec()
        )
    }
    #[cfg(not(unix))]
    {
        format!("{:?}:{hash}", meta.modified())
    }
}
fn read(path: &Path) -> Result<(Value, Metadata), ApiError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
    }
    let mut file = options.open(path).map_err(io)?;
    let before = file.metadata().map_err(io)?;
    if !before.is_file() {
        return Err(error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Only regular UTF-8 text files can be edited",
        ));
    }
    let mut data = Vec::new();
    (&mut file)
        .take(LIMIT as u64 + 1)
        .read_to_end(&mut data)
        .map_err(io)?;
    if data.len() > LIMIT {
        return Err(error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "File exceeds the 1 MiB editor limit",
        ));
    }
    let meta = file.metadata().map_err(io)?;
    if before.modified().ok() != meta.modified().ok()
        || before.len() != meta.len()
        || data.len() as u64 != meta.len()
    {
        return Err(error(
            StatusCode::CONFLICT,
            "File changed while being read; retry",
        ));
    }
    if data.contains(&0) {
        return Err(error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Binary files cannot be edited",
        ));
    }
    let text = std::str::from_utf8(&data)
        .map_err(|_| error(StatusCode::UNSUPPORTED_MEDIA_TYPE, "File is not UTF-8 text"))?;
    Ok((
        json!({"path":utf8(path)?, "text":text, "version":version(&meta, &data), "read_only":readonly(&meta)}),
        meta,
    ))
}
fn local(request: &Value) -> Result<Value, ApiError> {
    let path = resolve(request["path"].as_str().unwrap_or(""))?;
    match request["op"].as_str().unwrap_or("") {
        "list" => {
            if !path.is_dir() {
                return Err(error(StatusCode::BAD_REQUEST, "Path is not a directory"));
            }
            let mut entries = Vec::new();
            let mut skipped = 0;
            let mut truncated = false;
            for item in fs::read_dir(&path).map_err(io)? {
                let item = item.map_err(io)?;
                let Some(name) = item.file_name().to_str().map(str::to_owned) else {
                    skipped += 1;
                    continue;
                };
                if request["hidden"] != true && name.starts_with('.') {
                    continue;
                }
                if entries.len() == 2000 {
                    truncated = true;
                    break;
                }
                let symlink = item.file_type().map(|t| t.is_symlink()).unwrap_or(false);
                let (kind, size) = match fs::metadata(item.path()) {
                    Ok(m) => (
                        if m.is_dir() {
                            "directory"
                        } else if m.is_file() {
                            "file"
                        } else {
                            "other"
                        },
                        m.len(),
                    ),
                    Err(_) => ("unavailable", 0),
                };
                entries.push(json!({"name":name, "path":utf8(&item.path())?, "kind":kind, "symlink":symlink, "size":size}));
            }
            entries.sort_by(|a, b| {
                (a["kind"] != "directory", a["name"].as_str())
                    .cmp(&(b["kind"] != "directory", b["name"].as_str()))
            });
            Ok(
                json!({"path":utf8(&path)?, "entries":entries, "truncated":truncated, "unsupported_names":skipped}),
            )
        }
        "read" => {
            let current = read(&path)?.0;
            if request["known_version"].is_string()
                && request["known_version"] == current["version"]
            {
                Ok(json!({"path":current["path"],"version":current["version"],"unchanged":true}))
            } else {
                Ok(current)
            }
        }
        "write" => {
            let (current, meta) = read(&path)?;
            if utf8(&path)? != request["path"].as_str().unwrap_or("") {
                return Err(error(
                    StatusCode::CONFLICT,
                    "File location changed; reopen it before saving",
                ));
            }
            if current["version"] != request["version"] {
                return Err(error(
                    StatusCode::CONFLICT,
                    "File changed on disk. Your edits have been kept",
                ));
            }
            if let Some(reason) = readonly(&meta) {
                return Err(error(StatusCode::FORBIDDEN, reason));
            }
            let text = request["text"]
                .as_str()
                .ok_or_else(|| error(StatusCode::BAD_REQUEST, "Missing file text"))?;
            if text.len() > LIMIT {
                return Err(error(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "File exceeds the 1 MiB editor limit",
                ));
            }
            if text.contains('\0') {
                return Err(error(
                    StatusCode::UNSUPPORTED_MEDIA_TYPE,
                    "Binary content cannot be saved",
                ));
            }
            let mut options = OpenOptions::new();
            options.write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
            }
            let _permission_check = options.open(&path).map_err(io)?;
            let mut temporary =
                tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(io)?;
            temporary.write_all(text.as_bytes()).map_err(io)?;
            #[cfg(unix)]
            {
                use std::os::{fd::AsRawFd, unix::fs::MetadataExt};
                let fd = temporary.as_file().as_raw_fd();
                if temporary.as_file().metadata().map_err(io)?.gid() != meta.gid() {
                    // SAFETY: fd is the owned temporary file; -1 preserves UID.
                    if unsafe { libc::fchown(fd, !0 as libc::uid_t, meta.gid()) } != 0 {
                        return Err(io(std::io::Error::last_os_error()));
                    }
                }
                for name in xattr::list(&path).map_err(io)? {
                    if let Some(value) = xattr::get(&path, &name).map_err(io)?
                        && xattr::get(temporary.path(), &name).map_err(io)? != Some(value.clone())
                    {
                        xattr::set(temporary.path(), &name, &value).map_err(io)?;
                    }
                }
            }
            temporary
                .as_file()
                .set_permissions(meta.permissions())
                .map_err(io)?;
            temporary.as_file().sync_all().map_err(io)?;
            if read(&path)?.0["version"] != current["version"]
                || resolve(request["path"].as_str().unwrap())? != path
            {
                return Err(error(
                    StatusCode::CONFLICT,
                    "File changed during save. Your edits have been kept",
                ));
            }
            temporary.persist(&path).map_err(|e| io(e.error))?;
            Ok(read(&path)?.0)
        }
        _ => Err(error(StatusCode::BAD_REQUEST, "Unknown file operation")),
    }
}
async fn perform(machine: &machines::Machine, request: Value) -> Result<Value, ApiError> {
    let mut result = if machine.config.ssh.is_some() {
        let response = machine.transport.file_request(request).await?;
        if let Some(message) = response["error"].as_str() {
            return Err(error(
                StatusCode::from_u16(response["status"].as_u64().unwrap_or(502) as u16)
                    .unwrap_or(StatusCode::BAD_GATEWAY),
                message,
            ));
        }
        response
            .get("ok")
            .cloned()
            .ok_or_else(|| error(StatusCode::BAD_GATEWAY, "Invalid remote file response"))?
    } else {
        tokio::task::spawn_blocking(move || local(&request))
            .await
            .map_err(|e| error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))??
    };
    result["host"] = json!(machine.config.id);
    result["connection_revision"] = json!(machine.connection_revision);
    Ok(result)
}
fn check_connection(machine: &machines::Machine, expected: Option<&str>) -> Result<(), ApiError> {
    if expected.is_some_and(|s| s != machine.connection_revision) {
        return Err(error(
            StatusCode::CONFLICT,
            "Machine connection changed. Reopen this location before saving; your edits have been kept",
        ));
    }
    Ok(())
}
#[derive(Deserialize)]
pub(crate) struct ReadQuery {
    path: String,
    connection_revision: Option<String>,
    known_version: Option<String>,
    #[serde(default)]
    hidden: bool,
}
pub(crate) async fn list(
    State(state): State<Arc<AppState>>,
    HostPath(id): HostPath<String>,
    Query(query): Query<ReadQuery>,
) -> Result<Json<Value>, ApiError> {
    let machine = state.registry.get(&id).await?;
    check_connection(&machine, query.connection_revision.as_deref())?;
    let _slot = state.file_slots.try_acquire().map_err(|_| {
        error(
            StatusCode::TOO_MANY_REQUESTS,
            "File operations are busy; try again",
        )
    })?;
    Ok(Json(
        perform(
            &machine,
            json!({"op":"list", "path":query.path, "hidden":query.hidden}),
        )
        .await?,
    ))
}
pub(crate) async fn get(
    State(state): State<Arc<AppState>>,
    HostPath(id): HostPath<String>,
    Query(query): Query<ReadQuery>,
) -> Result<Json<Value>, ApiError> {
    let machine = state.registry.get(&id).await?;
    check_connection(&machine, query.connection_revision.as_deref())?;
    let _slot = state.file_slots.try_acquire().map_err(|_| {
        error(
            StatusCode::TOO_MANY_REQUESTS,
            "File operations are busy; try again",
        )
    })?;
    Ok(Json(
        perform(
            &machine,
            json!({"op":"read", "path":query.path, "known_version":query.known_version}),
        )
        .await?,
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Save {
    path: String,
    text: String,
    version: String,
    connection_revision: String,
}
pub(crate) async fn put(
    State(state): State<Arc<AppState>>,
    HostPath(id): HostPath<String>,
    Json(save): Json<Save>,
) -> Result<Json<Value>, ApiError> {
    if save.text.len() > LIMIT {
        return Err(error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "File exceeds the 1 MiB editor limit",
        ));
    }
    let machine = state.registry.get(&id).await?;
    check_connection(&machine, Some(&save.connection_revision))?;
    let _slot = state.file_slots.try_acquire().map_err(|_| {
        error(
            StatusCode::TOO_MANY_REQUESTS,
            "File operations are busy; try again",
        )
    })?;
    let _write = machine.file_writes.lock().await;
    Ok(Json(
        perform(
            &machine,
            json!({"op":"write", "path":save.path, "text":save.text, "version":save.version}),
        )
        .await?,
    ))
}
pub(crate) async fn projects(
    State(state): State<Arc<AppState>>,
    HostPath(id): HostPath<String>,
) -> Result<Json<Value>, ApiError> {
    let machine = state.registry.get(&id).await?;
    let settings = state.registry.settings().await;
    let mut found: BTreeMap<String, Value> = BTreeMap::new();
    for pin in &machine.config.projects {
        found.insert(
            pin.path.clone(),
            json!({"path":pin.path,"name":pin.name,"pinned":true,"python_venv":pin.python_venv,"windows":[]}),
        );
    }
    let mut discovery_error = None;
    match tmux::inventory(&machine.transport).await {
        Ok(inventory) => {
            for session in inventory.sessions {
                for window in session.windows {
                    for pane in window.panes {
                        if !Path::new(&pane.cwd).is_absolute() {
                            continue;
                        }
                        let label = Path::new(&pane.cwd)
                            .file_name()
                            .and_then(|p| p.to_str())
                            .unwrap_or("/");
                        let project = found.entry(pane.cwd.clone()).or_insert_with(
                            || json!({"path":pane.cwd,"name":label,"pinned":false,"windows":[]}),
                        );
                        let windows = project["windows"].as_array_mut().unwrap();
                        if !windows
                            .iter()
                            .any(|w| w["session"] == session.id && w["window"] == window.id)
                        {
                            windows.push(json!({"session":session.id,"session_name":session.name,"window":window.id,"window_name":window.name}));
                        }
                    }
                }
            }
        }
        Err(e) => discovery_error = Some(e.to_string()),
    }
    Ok(Json(
        json!({"host":id,"connection_revision":machine.connection_revision,"revision":settings.revision,"projects":found.into_values().collect::<Vec<_>>(),"discovery_error":discovery_error}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Pin {
    python_venv: Option<String>,
    revision: String,
    path: String,
    name: Option<String>,
    pinned: bool,
}
pub(crate) async fn pin(
    State(state): State<Arc<AppState>>,
    HostPath(id): HostPath<String>,
    Json(pin): Json<Pin>,
) -> Result<Json<machines::Settings>, ApiError> {
    let mut host = state.registry.get(&id).await?.config.clone();
    let python_venv = pin
        .python_venv
        .map(|v| if v.is_empty() { None } else { Some(v) })
        .unwrap_or_else(|| {
            host.projects
                .iter()
                .find(|p| p.path == pin.path)
                .and_then(|p| p.python_venv.clone())
        });
    host.projects.retain(|p| p.path != pin.path);
    if pin.pinned {
        let name = pin.name.unwrap_or_else(|| {
            Path::new(&pin.path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("/")
                .into()
        });
        host.projects.push(ProjectPin {
            python_venv,
            path: pin.path,
            name,
        });
    }
    host.validate()
        .map_err(|e| error(StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(Json(
        state
            .registry
            .apply(&pin.revision, machines::Change::Update(host))
            .await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(op: &str, path: &Path) -> Value {
        json!({"op":op,"path":path.to_str().unwrap()})
    }
    #[test]
    fn atomic_save_preserves_bytes_permissions_and_detects_stale_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("source.py");
        fs::write(&path, "\u{feff}# café\r\nprint('hello')\r\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let original = local(&request("read", &path)).unwrap();
        let mut save = request("write", &path);
        save["version"] = original["version"].clone();
        save["text"] = json!("\u{feff}# café\r\nprint('edited')\r\n");
        let updated = local(&save).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            save["text"].as_str().unwrap()
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o755
            );
        }
        assert_ne!(original["version"], updated["version"]);
        assert_eq!(local(&save).unwrap_err().0, StatusCode::CONFLICT);
        fs::write(&path, "external edit").unwrap();
        save["version"] = updated["version"].clone();
        assert_eq!(local(&save).unwrap_err().0, StatusCode::CONFLICT);
        assert_eq!(fs::read_to_string(path).unwrap(), "external edit");
    }
    #[test]
    fn binary_large_missing_and_relative_files_fail_without_modification() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file");
        fs::write(&path, [0, 1, 2]).unwrap();
        assert_eq!(
            local(&request("read", &path)).unwrap_err().0,
            StatusCode::UNSUPPORTED_MEDIA_TYPE
        );
        fs::write(&path, vec![b'a'; LIMIT + 1]).unwrap();
        assert_eq!(
            local(&request("read", &path)).unwrap_err().0,
            StatusCode::PAYLOAD_TOO_LARGE
        );
        assert_eq!(
            local(&request("read", &dir.path().join("missing")))
                .unwrap_err()
                .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            local(&json!({"op":"read","path":"relative"}))
                .unwrap_err()
                .0,
            StatusCode::BAD_REQUEST
        );
    }
    #[cfg(unix)]
    #[test]
    fn symlink_retarget_and_hard_links_cannot_redirect_a_save() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a");
        let b = dir.path().join("b");
        fs::write(&a, "first").unwrap();
        fs::write(&b, "second").unwrap();
        let original = local(&request("read", &a)).unwrap();
        fs::remove_file(&a).unwrap();
        symlink(&b, &a).unwrap();
        assert_eq!(
            local(&json!({"op":"write","path":a,"version":original["version"],"text":"wrong"}))
                .unwrap_err()
                .0,
            StatusCode::CONFLICT
        );
        assert_eq!(fs::read_to_string(&b).unwrap(), "second");
        fs::hard_link(&b, dir.path().join("alias")).unwrap();
        let current = local(&request("read", &b)).unwrap();
        assert!(current["read_only"].is_string());
        assert_eq!(
            local(&json!({"op":"write","path":b,"version":current["version"],"text":"wrong"}))
                .unwrap_err()
                .0,
            StatusCode::FORBIDDEN
        );
    }
    #[test]
    fn ssh_helper_matches_local_versions_and_rejects_stale_writes() {
        use std::process::{Command, Stdio};
        fn helper(request: Value) -> Value {
            let mut child = Command::new("python3")
                .args(["-c", include_str!("filesystem_remote.py")])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(&serde_json::to_vec(&request).unwrap())
                .unwrap();
            let output = child.wait_with_output().unwrap();
            assert!(output.status.success());
            serde_json::from_slice(&output.stdout).unwrap()
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("café ' tab\tline\n.py");
        fs::write(&path, "# UTF-8\r\nprint('literal')\r\n").unwrap();
        let local_file = local(&request("read", &path)).unwrap();
        let remote = helper(request("read", &path));
        assert_eq!(remote["ok"], local_file);
        let updated = helper(
            json!({"op":"write","path":path,"version":local_file["version"],"text":"remote edit\r\n"}),
        );
        assert!(updated["ok"].is_object(), "{updated}");
        assert_eq!(updated["ok"], local(&request("read", &path)).unwrap());
        assert_eq!(
            helper(
                json!({"op":"write","path":path,"version":local_file["version"],"text":"stale"})
            )["status"],
            409
        );
        assert_eq!(fs::read_to_string(path).unwrap(), "remote edit\r\n");
    }
}
