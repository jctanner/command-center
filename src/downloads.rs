//! Binary file downloads use the same strict local/SSH route as Files, with
//! bounded memory and process lifetime tied to the browser response body.
use crate::{ApiError, AppState};
use axum::{
    body::{Body, Bytes},
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::Response,
};
use serde::Deserialize;
use serde_json::json;
use std::{io, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, BufReader},
    process::{Child, ChildStdout},
    sync::OwnedSemaphorePermit,
    time::Instant,
};
const LIMIT: u64 = 8 * 1024 * 1024 * 1024;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Request {
    path: String,
    connection_revision: String,
    version: Option<String>,
}
#[derive(Deserialize)]
struct Metadata {
    path: String,
    name: String,
    size: u64,
    version: String,
}
fn failure(message: impl Into<String>) -> io::Error {
    io::Error::other(message.into())
}
fn disposition(name: &str) -> String {
    let encoded = name
        .as_bytes()
        .iter()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"!#$&+-.^_`|~".contains(b) {
                (*b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect::<String>();
    format!("attachment; filename=\"download\"; filename*=UTF-8''{encoded}")
}
struct Transfer {
    child: Child,
    reader: BufReader<ChildStdout>,
    remaining: u64,
    state: Arc<AppState>,
    host: String,
    revision: String,
    deadline: Instant,
    _permit: OwnedSemaphorePermit,
}
impl Transfer {
    async fn connection(&self) -> Result<(), io::Error> {
        let m = self
            .state
            .registry
            .get(&self.host)
            .await
            .map_err(|_| failure("Machine unavailable"))?;
        if m.connection_revision != self.revision {
            return Err(failure("Machine connection changed during download"));
        }
        Ok(())
    }
}
pub(crate) async fn get(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Query(request): Query<Request>,
) -> Result<Response, ApiError> {
    let m = state.registry.get(&host).await?;
    if m.connection_revision != request.connection_revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine connection changed; reopen the file location".into(),
        ));
    }
    if request.path.is_empty()
        || request.path.len() > 4096
        || request.path.contains('\0')
        || request
            .version
            .as_ref()
            .is_some_and(|v| v.len() != 64 || !v.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Invalid download path or version".into(),
        ));
    }
    let permit = state
        .download_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "Two downloads are already active; try again when one finishes".into(),
            )
        })?;
    let (mut child, reader, line) = tokio::time::timeout(Duration::from_secs(25), async {
        let mut child = m
            .transport
            .download_process(json!({"path":request.path,"version":request.version}))
            .await?;
        let mut reader = BufReader::with_capacity(
            64 * 1024,
            child
                .stdout
                .take()
                .ok_or_else(|| anyhow::anyhow!("Download stdout unavailable"))?,
        );
        let mut line = Vec::new();
        loop {
            let byte = reader.read_u8().await?;
            if byte == b'\n' {
                break;
            }
            line.push(byte);
            anyhow::ensure!(line.len() <= 65536, "Download metadata exceeded limit");
        }
        Ok::<_, anyhow::Error>((child, reader, line))
    })
    .await
    .map_err(|_| {
        ApiError(
            StatusCode::GATEWAY_TIMEOUT,
            "Download connection timed out".into(),
        )
    })?
    .map_err(|_| {
        ApiError(
            StatusCode::BAD_GATEWAY,
            "File download unavailable; check the machine connection".into(),
        )
    })?;
    let value: serde_json::Value = serde_json::from_slice(&line)
        .map_err(|_| ApiError(StatusCode::BAD_GATEWAY, "Invalid file metadata".into()))?;
    if let Some(message) = value["error"].as_str() {
        return Err(ApiError(
            StatusCode::from_u16(value["status"].as_u64().unwrap_or(502) as u16)
                .unwrap_or(StatusCode::BAD_GATEWAY),
            message.chars().take(240).collect(),
        ));
    }
    let meta: Metadata = serde_json::from_value(value["ok"].clone())
        .map_err(|_| ApiError(StatusCode::BAD_GATEWAY, "Invalid file metadata".into()))?;
    if meta.size > LIMIT
        || meta.name.len() > 4096
        || !meta.path.starts_with('/')
        || meta.version.len() != 64
        || !meta.version.bytes().all(|v| v.is_ascii_hexdigit())
    {
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            "Invalid file metadata".into(),
        ));
    }
    if state.registry.get(&host).await?.connection_revision != request.connection_revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine connection changed before download".into(),
        ));
    }
    if meta.size == 0
        && !tokio::time::timeout(Duration::from_secs(10), child.wait())
            .await
            .map_err(|_| {
                ApiError(
                    StatusCode::GATEWAY_TIMEOUT,
                    "Download completion timed out".into(),
                )
            })?
            .map_err(anyhow::Error::from)?
            .success()
    {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "File changed during download".into(),
        ));
    }
    let transfer = Transfer {
        child,
        reader,
        remaining: meta.size,
        state,
        host,
        revision: request.connection_revision,
        deadline: Instant::now() + Duration::from_secs(15 * 60),
        _permit: permit,
    };
    let stream = futures_util::stream::try_unfold(transfer, |mut t| async move {
        if t.remaining == 0 {
            return Ok::<_, io::Error>(None);
        }
        if Instant::now() > t.deadline {
            return Err(failure("Download exceeded the 15 minute time limit"));
        }
        t.connection().await?;
        let mut data = vec![0; std::cmp::min(t.remaining, 64 * 1024) as usize];
        tokio::time::timeout(Duration::from_secs(30), t.reader.read_exact(&mut data))
            .await
            .map_err(|_| failure("Download stalled"))??;
        t.remaining -= data.len() as u64;
        if t.remaining == 0
            && !tokio::time::timeout(Duration::from_secs(10), t.child.wait())
                .await
                .map_err(|_| failure("Download completion stalled"))??
                .success()
        {
            return Err(failure("File changed or transport failed during download"));
        }
        t.connection().await?;
        Ok(Some((Bytes::from(data), t)))
    });
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_DISPOSITION, disposition(&meta.name))
        .header(header::CONTENT_LENGTH, meta.size)
        .header(header::CACHE_CONTROL, "no-store")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "sandbox; default-src 'none'")
        .header("x-cc-file-version", meta.version)
        .body(Body::from_stream(stream))
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn attachment_names_cannot_inject_headers_or_paths() {
        let value = disposition("report \"résumé\"\r\nX-Evil: yes.mp4");
        assert!(!value.contains('\r'));
        assert!(!value.contains('\n'));
        assert!(value.contains("%C3%A9"));
        assert!(value.starts_with("attachment;"));
    }
}
