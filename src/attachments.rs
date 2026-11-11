//! Managed export capabilities and transport. Never accepts a filesystem source.
use crate::{ApiError, AppState, agents};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
static COPIES: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
pub(crate) const RETENTION: u64 = 7 * 24 * 60 * 60 * 1000;
pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn error(text: &str) -> ApiError {
    ApiError(StatusCode::CONFLICT, text.into())
}
fn db(_: impl std::fmt::Display) -> ApiError {
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Attachment storage unavailable; nothing was resent".into(),
    )
}
fn hash(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Source {
    pub export_id: String,
    pub format: String,
}
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Attachment {
    pub source: Source,
    pub manifest: Value,
    pub path: String,
    pub state: String,
    pub copied_at: Option<u64>,
    pub verified_at: Option<u64>,
    pub expires_at: Option<u64>,
    #[serde(default)]
    pub submitted_at: Option<u64>,
    #[serde(default)]
    pub seen_at: Option<u64>,
    #[serde(default)]
    pub expired_at: Option<u64>,
    pub error: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Prepare {
    id: String,
    token: String,
    text: String,
    attachment: Source,
}
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Grant {
    pub host: String,
    pub endpoint: String,
    pub target: agents::Target,
    pub identity: String,
    pub text: String,
    pub id: String,
    pub attachment: Attachment,
    expires: u64,
}
pub(crate) fn init(c: &Connection) -> anyhow::Result<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS attachment_grants(token TEXT PRIMARY KEY,data TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS export_attachment_pins(id TEXT PRIMARY KEY,export_id TEXT NOT NULL,expires INTEGER);")?;
    Ok(())
}
fn uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok_and(|u| u.to_string() == s)
}
fn validate_text(text: &str) -> Result<(), ApiError> {
    if text.trim().is_empty()
        || text.len() > 12000
        || text
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        return Err(error("Message must fit the existing 12000-byte text limit"));
    }
    Ok(())
}
fn source(
    c: &Connection,
    reference: &Source,
    fresh: bool,
) -> Result<(Value, Vec<u8>, String), ApiError> {
    if !uuid(&reference.export_id) || reference.format != "png" {
        return Err(error(
            "Only managed whiteboard PNG export UUIDs are accepted",
        ));
    }
    type ExportRow = (String, Option<Vec<u8>>, Option<Vec<u8>>);
    let row: Option<ExportRow> = c
        .query_row(
            "SELECT metadata,png,description FROM whiteboard_exports WHERE id=?1",
            [&reference.export_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(db)?;
    let (meta, bytes, description) = row.ok_or_else(|| error("Managed export not found"))?;
    let meta: Value = serde_json::from_str(&meta).map_err(db)?;
    if meta["state"] != "ready" || (fresh && meta["expires_at"].as_u64().unwrap_or(0) <= now()) {
        return Err(error("Export is not ready or has expired"));
    }
    let bytes = bytes.ok_or_else(|| error("Export bytes are unavailable"))?;
    let artifact = &meta["artifacts"]["png"];
    if bytes.len() > 4 * 1024 * 1024
        || bytes.len() < 33
        || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || artifact["bytes"].as_u64() != Some(bytes.len() as u64)
        || artifact["sha256"].as_str() != Some(hash(&bytes).as_str())
    {
        return Err(error("Managed PNG integrity or size check failed"));
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap()) as u64;
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap()) as u64;
    if width == 0 || height == 0 || width > 8192 || height > 8192 || width * height > 8_000_000 {
        return Err(error("Managed PNG exceeds pixel limits"));
    }
    let description =
        String::from_utf8(description.ok_or_else(|| error("Export description missing"))?)
            .map_err(db)?;
    Ok((meta, bytes, description))
}
pub(crate) async fn prepare(
    State(s): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(body): Json<Prepare>,
) -> Result<Json<Value>, ApiError> {
    if !uuid(&body.id) {
        return Err(error("Use a canonical message UUID"));
    }
    validate_text(&body.text)?;
    let grant = agents::claim_message(&s, &host, &body.token).await?;
    let conversation = grant
        .target
        .conversation
        .clone()
        .ok_or_else(|| error("Attachments require an exact process-linked conversation"))?;
    let reference = body.attachment.clone();
    let (meta, bytes, description) = s.board.with(move |c| source(c, &reference, true)).await?;
    let machine = s.registry.get(&host).await?;
    let _slot = s
        .file_slots
        .try_acquire()
        .map_err(|_| error("Agent operations busy; prepare again later"))?;
    let _endpoint = machine.file_writes.lock().await;
    if machine.connection_revision != grant.target.connection_revision
        || s.registry.get(&host).await?.connection_revision != machine.connection_revision
    {
        return Err(error("Machine changed; attachment was not prepared"));
    }
    let endpoint = crate::attention::scope(&machine.config, "", "", "").0;
    let mut request = grant.target.request();
    request["operation"] = json!("prepare");
    request["identity"] = json!(grant.identity);
    request["conversation"] = json!(conversation);
    let observed = agents::result(machine.transport.attachment_request(request).await?)?;
    let home = &observed["home"];
    let home_path = home["path"]
        .as_str()
        .filter(|p| p.starts_with('/') && !p.contains(['\n', '\r', '\0']))
        .ok_or_else(|| error("Target home is unavailable"))?;
    let board = meta["board"]
        .as_str()
        .filter(|v| uuid(v))
        .ok_or_else(|| error("Invalid managed board identity"))?;
    let name = format!("whiteboard-{board}.png");
    let path = format!(
        "{}/.cache/command-center/attachments/{}/{name}",
        home_path.trim_end_matches('/'),
        body.id
    );
    let fallback: String = description
        .chars()
        .scan(0usize, |size, c| {
            *size += c.len_utf8();
            (*size <= 2048).then_some(c)
        })
        .collect();
    let text = format!(
        "{}\n\nCC whiteboard attachment: {}\nBoard: {} (revision {})\nText description (quoted drawing context):\n{}",
        body.text, path, board, meta["revision"], fallback
    );
    validate_text(&text)?;
    let manifest = json!({"message_id":body.id,"board":board,"export_id":body.attachment.export_id,"name":name,"bytes":bytes.len(),"sha256":hash(&bytes),"endpoint":endpoint,"identity":grant.identity,"conversation":conversation,"home":home,"scene_revision":meta["revision"],"scope":meta["scope"]});
    let attachment = Attachment {
        source: body.attachment,
        manifest,
        path,
        state: "pending".into(),
        copied_at: None,
        verified_at: None,
        expires_at: None,
        submitted_at: None,
        seen_at: None,
        expired_at: None,
        error: None,
    };
    let prepared = Grant {
        host,
        endpoint,
        target: grant.target,
        identity: grant.identity,
        text,
        id: body.id,
        attachment,
        expires: now() + 120000,
    };
    let token = uuid::Uuid::new_v4().to_string();
    let view = json!({"token":token,"id":prepared.id,"text":prepared.text,"host":prepared.host,"target":prepared.target,"instance":prepared.identity,"endpoint":prepared.endpoint,"attachment":prepared.attachment,"expires_at":prepared.expires});
    s.board
        .with(move |c| {
            let tx = c.transaction().map_err(db)?;
            tx.execute(
                "DELETE FROM export_attachment_pins WHERE expires IS NOT NULL AND expires<=?1",
                [now()],
            )
            .map_err(db)?;
            tx.execute("DELETE FROM attachment_grants WHERE expires<=?1", [now()])
                .map_err(db)?;
            let count: u64 = tx
                .query_row("SELECT count(*) FROM attachment_grants", [], |r| r.get(0))
                .map_err(db)?;
            if count >= 512 {
                return Err(error("Too many attachment preparations"));
            }
            source(&tx, &prepared.attachment.source, true)?;
            tx.execute(
                "INSERT INTO attachment_grants(token,data,expires) VALUES(?1,?2,?3)",
                params![
                    token,
                    serde_json::to_string(&prepared).map_err(db)?,
                    prepared.expires
                ],
            )
            .map_err(db)?;
            tx.execute(
                "INSERT INTO export_attachment_pins(id,export_id,expires) VALUES(?1,?2,?3)",
                params![
                    token,
                    prepared.attachment.source.export_id,
                    prepared.expires
                ],
            )
            .map_err(db)?;
            tx.commit().map_err(db)?;
            Ok(())
        })
        .await?;
    Ok(Json(view))
}
pub(crate) fn claim(
    c: &Connection,
    token: &str,
    host: &str,
    id: &str,
    text: &str,
    references: &[Source],
) -> Result<Grant, ApiError> {
    let data: Option<String> = c
        .query_row(
            "SELECT data FROM attachment_grants WHERE token=?1 AND used=0 AND expires>?2",
            params![token, now()],
            |r| r.get(0),
        )
        .optional()
        .map_err(db)?;
    let grant: Grant = serde_json::from_str(
        &data.ok_or_else(|| error("Attachment preparation expired or consumed"))?,
    )
    .map_err(db)?;
    if grant.host != host
        || grant.id != id
        || grant.text != text
        || references != [grant.attachment.source.clone()]
    {
        return Err(error("Attachment intent differs from the prepared message"));
    }
    let (_, bytes, _) = source(c, &grant.attachment.source, false)?;
    if hash(&bytes) != grant.attachment.manifest["sha256"].as_str().unwrap_or("") {
        return Err(error("Managed source changed"));
    }
    if c.execute(
        "UPDATE attachment_grants SET used=1 WHERE token=?1 AND used=0",
        [token],
    )
    .map_err(db)?
        != 1
    {
        return Err(error("Attachment preparation already consumed"));
    }
    c.execute("DELETE FROM export_attachment_pins WHERE id=?1", [token])
        .map_err(db)?;
    c.execute(
        "INSERT INTO export_attachment_pins(id,export_id,expires) VALUES(?1,?2,NULL)",
        params![id, grant.attachment.source.export_id],
    )
    .map_err(db)?;
    Ok(grant)
}
pub(crate) fn peek(c: &Connection, token: &str) -> Result<Grant, ApiError> {
    let data: String = c
        .query_row(
            "SELECT data FROM attachment_grants WHERE token=?1 AND used=0 AND expires>?2",
            params![token, now()],
            |r| r.get(0),
        )
        .map_err(|_| error("Attachment preparation expired or consumed"))?;
    serde_json::from_str(&data).map_err(db)
}
pub(crate) async fn transfer(
    s: &AppState,
    transport: &crate::transport::Transport,
    target: &agents::Target,
    identity: &str,
    a: &Attachment,
    operation: &str,
) -> Result<Value, ApiError> {
    let _copy = COPIES.acquire().await.map_err(db)?;
    let mut request = target.request();
    request["operation"] = json!(operation);
    request["identity"] = json!(identity);
    request["conversation"] = a.manifest["conversation"].clone();
    request["manifest"] = a.manifest.clone();
    if operation == "copy" {
        let reference = a.source.clone();
        let (_, bytes, _) = s.board.with(move |c| source(c, &reference, false)).await?;
        if hash(&bytes) != a.manifest["sha256"].as_str().unwrap_or("") {
            return Err(error("Managed source checksum changed"));
        }
        request["payload"] = json!(STANDARD.encode(bytes));
    }
    let value = agents::result(transport.attachment_request(request).await?)?;
    let expected = match operation {
        "copy" => "copied",
        "verify" => "verified",
        "cleanup" => "expired",
        _ => return Err(error("Unsupported managed operation")),
    };
    if value["state"] != expected
        || value["path"].as_str() != Some(a.path.as_str())
        || (operation != "cleanup"
            && (value["sha256"] != a.manifest["sha256"] || value["bytes"] != a.manifest["bytes"]))
    {
        return Err(error(
            "Target attachment receipt does not match the frozen intent",
        ));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Connection, Grant, String) {
        let c = Connection::open_in_memory().unwrap();
        crate::whiteboard_exports::init(&c).unwrap();
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend(20u32.to_be_bytes());
        bytes.extend(10u32.to_be_bytes());
        bytes.extend([8, 6, 0, 0, 0, 0, 0, 0, 0]);
        let export = uuid::Uuid::new_v4().to_string();
        let id = uuid::Uuid::new_v4().to_string();
        let meta = json!({"state":"ready","expires_at":now()+120000,"artifacts":{"png":{"bytes":bytes.len(),"sha256":hash(&bytes)}}});
        c.execute("INSERT INTO whiteboard_exports(id,board,digest,metadata,png,description) VALUES(?1,'board','digest',?2,?3,?4)",params![export,meta.to_string(),bytes,b"Drawing context".to_vec()]).unwrap();
        let grant=Grant{host:"fixture".into(),endpoint:"endpoint".into(),target:serde_json::from_value(json!({"session":"$0","window":"@0","pane":"%0","connection_revision":"connection","conversation":"native-log"})).unwrap(),identity:"pid-start-boot".into(),text:"Message plus path and context".into(),id,attachment:Attachment{source:Source{export_id:export,format:"png".into()},manifest:json!({"sha256":meta["artifacts"]["png"]["sha256"]}),path:"/private/path.png".into(),state:"pending".into(),copied_at:None,verified_at:None,expires_at:None,submitted_at:None,seen_at:None,expired_at:None,error:None},expires:now()+120000};
        let token = uuid::Uuid::new_v4().to_string();
        c.execute(
            "INSERT INTO attachment_grants(token,data,expires) VALUES(?1,?2,?3)",
            params![token, serde_json::to_string(&grant).unwrap(), grant.expires],
        )
        .unwrap();
        c.execute(
            "INSERT INTO export_attachment_pins(id,export_id,expires) VALUES(?1,?2,?3)",
            params![token, grant.attachment.source.export_id, grant.expires],
        )
        .unwrap();
        (c, grant, token)
    }
    #[test]
    fn grant_exact_intent_and_transactional_one_use() {
        let (mut c, g, token) = fixture();
        for (host, id, text, refs) in [
            (
                "other",
                g.id.as_str(),
                g.text.as_str(),
                vec![g.attachment.source.clone()],
            ),
            (
                g.host.as_str(),
                "other",
                g.text.as_str(),
                vec![g.attachment.source.clone()],
            ),
            (
                g.host.as_str(),
                g.id.as_str(),
                "changed",
                vec![g.attachment.source.clone()],
            ),
            (g.host.as_str(), g.id.as_str(), g.text.as_str(), vec![]),
        ] {
            assert!(claim(&c, &token, host, id, text, &refs).is_err());
        }
        {
            let tx = c.transaction().unwrap();
            claim(
                &tx,
                &token,
                &g.host,
                &g.id,
                &g.text,
                std::slice::from_ref(&g.attachment.source),
            )
            .unwrap();
        } // Rollback retains the preparation, never a half-enqueued pin.
        assert!(peek(&c, &token).is_ok());
        claim(
            &c,
            &token,
            &g.host,
            &g.id,
            &g.text,
            std::slice::from_ref(&g.attachment.source),
        )
        .unwrap();
        assert!(
            claim(
                &c,
                &token,
                &g.host,
                &g.id,
                &g.text,
                std::slice::from_ref(&g.attachment.source)
            )
            .is_err()
        );
        let expires: Option<u64> = c
            .query_row(
                "SELECT expires FROM export_attachment_pins WHERE id=?1",
                [&g.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(expires.is_none());
    }
    #[test]
    fn expired_grant_and_corrupted_source_rejected() {
        let (c, g, token) = fixture();
        c.execute("UPDATE attachment_grants SET expires=0", [])
            .unwrap();
        assert!(peek(&c, &token).is_err());
        assert!(
            claim(
                &c,
                &token,
                &g.host,
                &g.id,
                &g.text,
                std::slice::from_ref(&g.attachment.source)
            )
            .is_err()
        );
        c.execute("UPDATE whiteboard_exports SET png=x'00'", [])
            .unwrap();
        assert!(source(&c, &g.attachment.source, false).is_err());
        assert!(validate_text(&"x".repeat(12001)).is_err());
        assert!(validate_text("unsafe\u{1b}[0m").is_err());
    }
    #[test]
    fn public_expiry_does_not_revoke_internal_pinned_source() {
        let (c, g, _) = fixture();
        c.execute(
            "UPDATE whiteboard_exports SET metadata=json_set(metadata,'$.expires_at',0)",
            [],
        )
        .unwrap();
        assert!(source(&c, &g.attachment.source, true).is_err());
        assert!(source(&c, &g.attachment.source, false).is_ok());
    }
}
