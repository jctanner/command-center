//! Board-scoped, bounded raster blobs. Scenes/history contain references only.
use crate::{ApiError, AppState, whiteboard};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use image::{ImageFormat, ImageReader};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::Cursor,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
pub const BYTE_LIMIT: usize = 4 * 1024 * 1024;
const PIXELS: u64 = 8_000_000;
static SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
fn bad(s: &str) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, s.into())
}
fn db(_: impl std::fmt::Display) -> ApiError {
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Whiteboard image storage unavailable".into(),
    )
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct ImageRef {
    pub id: String,
    pub width: u32,
    pub height: u32,
}
pub(crate) fn valid(r: &ImageRef) -> bool {
    r.id.len() == 64
        && r.id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && r.width > 0
        && r.height > 0
        && r.width <= 8192
        && r.height <= 8192
        && u64::from(r.width) * u64::from(r.height) <= PIXELS
}
pub(crate) fn init(c: &Connection) -> anyhow::Result<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS whiteboard_images(board TEXT NOT NULL,id TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,created INTEGER NOT NULL,png BLOB NOT NULL,PRIMARY KEY(board,id));")?;
    Ok(())
}
// Decode off the async executor with bounded concurrency, dimensions and allocation.
fn normalize(bytes: &[u8]) -> Result<(ImageRef, Vec<u8>), ApiError> {
    if bytes.is_empty() || bytes.len() > BYTE_LIMIT {
        return Err(bad("Image must be at most 4 MiB"));
    }
    let format = image::guess_format(bytes).map_err(|_| bad("Unsupported image bytes"))?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::Gif | ImageFormat::WebP
    ) {
        return Err(bad(
            "Only PNG, JPEG, GIF and WebP are supported; SVG is not accepted",
        ));
    }
    let reader = || {
        let mut r = ImageReader::with_format(Cursor::new(bytes), format);
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        limits.max_alloc = Some(64 * 1024 * 1024);
        r.limits(limits);
        r
    };
    let (width, height) = reader()
        .into_dimensions()
        .map_err(|_| bad("Invalid image dimensions"))?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > PIXELS {
        return Err(bad("Image exceeds 8 megapixels"));
    }
    let raster = reader()
        .decode()
        .map_err(|_| bad("Invalid or oversized image"))?;
    let mut out = Cursor::new(Vec::new());
    raster
        .to_rgba8()
        .write_to(&mut out, ImageFormat::Png)
        .map_err(|_| bad("Image normalization failed"))?;
    let png = out.into_inner();
    if png.len() > BYTE_LIMIT {
        return Err(bad("Normalized PNG exceeds 4 MiB"));
    }
    let id = format!("{:x}", Sha256::digest(&png));
    Ok((ImageRef { id, width, height }, png))
}
pub(crate) fn require(c: &Connection, board: &str, r: &ImageRef) -> Result<(), ApiError> {
    let exists:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM whiteboard_images WHERE board=?1 AND id=?2 AND width=?3 AND height=?4)",params![board,r.id,r.width,r.height],|row|row.get(0)).map_err(db)?;
    if !exists {
        return Err(bad(
            "Image is missing from this board or dimensions do not match",
        ));
    }
    Ok(())
}
// Retained history keeps undo references alive. Unplaced uploads get a 24h grace period.
pub(crate) fn gc(c: &Connection) -> Result<(), ApiError> {
    c.execute("DELETE FROM whiteboard_images WHERE board IN (SELECT id FROM whiteboards WHERE deleted=1) OR (created<?1 AND NOT EXISTS(SELECT 1 FROM whiteboards b,json_each(b.data,'$.elements') e WHERE b.id=whiteboard_images.board AND json_extract(e.value,'$.image.id')=whiteboard_images.id) AND NOT EXISTS(SELECT 1 FROM whiteboard_history h,json_each(h.data,'$.elements') e WHERE h.board=whiteboard_images.board AND json_extract(e.value,'$.image.id')=whiteboard_images.id))",[now().saturating_sub(24*60*60*1000)]).map_err(db)?;
    Ok(())
}
fn store(
    c: &mut Connection,
    board: &str,
    revision: u64,
    r: &ImageRef,
    png: &[u8],
) -> Result<(), ApiError> {
    let tx = c.transaction().map_err(db)?;
    let s = whiteboard::load(&tx, board)?;
    if s.revision != revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Whiteboard changed; refresh before uploading".into(),
        ));
    }
    gc(&tx)?;
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM whiteboard_images WHERE board=?1 AND id=?2)",
            params![board, r.id],
            |row| row.get(0),
        )
        .map_err(db)?;
    if !exists {
        let (all,local,pixels):(u64,u64,u64)=tx.query_row("SELECT coalesce(sum(length(png)),0),coalesce(sum(CASE WHEN board=?1 THEN length(png) ELSE 0 END),0),coalesce(sum(CASE WHEN board=?1 THEN width*height ELSE 0 END),0) FROM whiteboard_images",[board],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(db)?;
        if pixels + u64::from(r.width) * u64::from(r.height) > 32_000_000
            || all + png.len() as u64 > 64 * 1024 * 1024
            || local + png.len() as u64 > 16 * 1024 * 1024
        {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Whiteboard image capacity reached".into(),
            ));
        }
        tx.execute(
            "INSERT INTO whiteboard_images VALUES(?1,?2,?3,?4,?5,?6)",
            params![board, r.id, r.width, r.height, now(), png],
        )
        .map_err(db)?;
    } else {
        tx.execute(
            "UPDATE whiteboard_images SET created=?3 WHERE board=?1 AND id=?2",
            params![board, r.id, now()],
        )
        .map_err(db)?;
    }
    tx.commit().map_err(db)?;
    Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UploadQuery {
    revision: u64,
}
async fn upload(
    State(s): State<Arc<AppState>>,
    Path(board): Path<String>,
    Query(q): Query<UploadQuery>,
    body: Bytes,
) -> Result<Json<ImageRef>, ApiError> {
    let slot = SLOTS.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Another image is decoding; try again after it finishes".into(),
        )
    })?;
    let check = board.clone();
    s.board
        .with(move |c| {
            let scene = whiteboard::load(c, &check)?;
            if scene.revision != q.revision {
                return Err(ApiError(
                    StatusCode::CONFLICT,
                    "Whiteboard changed; refresh before uploading".into(),
                ));
            }
            Ok(())
        })
        .await?;
    let (r, png) = tokio::task::spawn_blocking(move || {
        let _slot = slot;
        normalize(&body)
    })
    .await
    .map_err(db)??;
    let result = r.clone();
    s.board
        .with(move |c| store(c, &board, q.revision, &r, &png))
        .await?;
    Ok(Json(result))
}
async fn download(
    State(s): State<Arc<AppState>>,
    Path((board, id)): Path<(String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    s.board
        .with(move |c| {
            whiteboard::load(c, &board)?;
            gc(c)?;
            let png: Option<Vec<u8>> = c
                .query_row(
                    "SELECT png FROM whiteboard_images WHERE board=?1 AND id=?2",
                    params![board, id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(db)?;
            Ok((
                [
                    (header::CONTENT_TYPE, "image/png"),
                    (header::CACHE_CONTROL, "no-store"),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                ],
                png.ok_or_else(|| {
                    ApiError(
                        StatusCode::NOT_FOUND,
                        "Image not found on this board".into(),
                    )
                })?,
            ))
        })
        .await
}
pub(crate) fn render_images(
    c: &Connection,
    s: &whiteboard::Scene,
) -> Result<BTreeMap<String, String>, ApiError> {
    let mut map = BTreeMap::new();
    let mut bytes = 0;
    let mut pixels = 0u64;
    for e in &s.elements {
        if let Some(r) = &e.drawing.image {
            if map.contains_key(&r.id) {
                continue;
            }
            require(c, &s.id, r)?;
            let png: Vec<u8> = c
                .query_row(
                    "SELECT png FROM whiteboard_images WHERE board=?1 AND id=?2",
                    params![s.id, r.id],
                    |r| r.get(0),
                )
                .map_err(db)?;
            bytes += png.len();
            pixels += u64::from(r.width) * u64::from(r.height);
            if bytes > BYTE_LIMIT || pixels > 16_000_000 {
                return Err(bad(
                    "Export images exceed 4 MiB or 16 MP aggregate budget; export a selection",
                ));
            }
            map.insert(
                r.id.clone(),
                format!("data:image/png;base64,{}", STANDARD.encode(png)),
            );
        }
    }
    Ok(map)
}
pub(crate) fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/api/v1/whiteboards/{id}/images",
            post(upload).layer(DefaultBodyLimit::max(BYTE_LIMIT)),
        )
        .route("/api/v1/whiteboards/{id}/images/{image}", get(download))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn raster(format: ImageFormat) -> Vec<u8> {
        let mut out = Cursor::new(vec![]);
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            32,
            16,
            image::Rgba([240, 20, 30, 255]),
        ))
        .to_rgb8()
        .write_to(&mut out, format)
        .unwrap();
        out.into_inner()
    }
    #[test]
    fn sniffs_and_normalizes_rasters_not_svg_or_claimed_mime() {
        for format in [
            ImageFormat::Png,
            ImageFormat::Jpeg,
            ImageFormat::Gif,
            ImageFormat::WebP,
        ] {
            let (r, png) = normalize(&raster(format)).unwrap();
            assert_eq!((r.width, r.height), (32, 16));
            assert!(valid(&r));
            assert_eq!(image::guess_format(&png).unwrap(), ImageFormat::Png);
            assert_eq!(normalize(&png).unwrap().0, r);
        }
        for bytes in [
            b"<svg xmlns='http://www.w3.org/2000/svg'/>".as_slice(),
            b"not an image",
            b"\x89PNG\r\n\x1a\n",
        ] {
            assert!(normalize(bytes).is_err());
        }
        assert!(normalize(&vec![0; BYTE_LIMIT + 1]).is_err());
    }
    #[test]
    fn animated_gif_keeps_first_frame_and_large_normalized_output_is_rejected() {
        let mut animation = vec![];
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut animation);
            for color in [[250, 10, 20, 255], [10, 20, 250, 255]] {
                encoder
                    .encode_frame(image::Frame::new(image::RgbaImage::from_pixel(
                        4,
                        2,
                        image::Rgba(color),
                    )))
                    .unwrap();
            }
        }
        let (_, normalized) = normalize(&animation).unwrap();
        let decoded = image::load_from_memory(&normalized).unwrap().to_rgba8();
        assert_eq!(decoded.get_pixel(0, 0).0, [250, 10, 20, 255]);
        let mut seed = 7u32;
        let noisy = image::RgbImage::from_fn(1400, 1400, |_, _| {
            let mut c = [0; 3];
            for v in &mut c {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                *v = seed as u8;
            }
            image::Rgb(c)
        });
        let mut jpeg = vec![];
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 80)
            .encode_image(&noisy)
            .unwrap();
        assert!(jpeg.len() < BYTE_LIMIT);
        assert!(normalize(&jpeg).unwrap_err().1.contains("Normalized PNG"));
    }
    #[test]
    fn dimensions_and_normalized_bytes_are_bounded() {
        let img = image::RgbImage::new(4000, 2001);
        let mut out = Cursor::new(vec![]);
        img.write_to(&mut out, ImageFormat::Png).unwrap();
        assert!(out.get_ref().len() < BYTE_LIMIT);
        assert!(normalize(out.get_ref()).is_err());
        let mut r = ImageRef {
            id: "a".repeat(64),
            width: 8193,
            height: 1,
        };
        assert!(!valid(&r));
        r.width = 8000;
        r.height = 1000;
        assert!(valid(&r));
        r.id = "https://example.org/x.png".into();
        assert!(!valid(&r));
    }
    #[test]
    fn scoped_store_revisions_gc_and_retained_history() {
        let mut c = Connection::open_in_memory().unwrap();
        whiteboard::init(&c).unwrap();
        let board = uuid::Uuid::new_v4().to_string();
        let other = uuid::Uuid::new_v4().to_string();
        for id in [&board, &other] {
            c.execute("INSERT INTO whiteboards VALUES(?1,?2,0)",params![id,serde_json::json!({"id":id,"name":"Fixture","revision":1,"metadata_revision":"m","ticket":null,"elements":[],"updated_at":0}).to_string()]).unwrap();
        }
        let (r, png) = normalize(&raster(ImageFormat::Png)).unwrap();
        assert_eq!(
            store(&mut c, &board, 0, &r, &png).unwrap_err().0,
            StatusCode::CONFLICT
        );
        store(&mut c, &board, 1, &r, &png).unwrap();
        store(&mut c, &board, 1, &r, &png).unwrap();
        assert!(require(&c, &other, &r).is_err());
        assert_eq!(
            c.query_row("SELECT count(*) FROM whiteboard_images", [], |r| r
                .get::<_, u32>(0))
                .unwrap(),
            1
        );
        c.execute("UPDATE whiteboard_images SET created=0", [])
            .unwrap();
        c.execute(
            "INSERT INTO whiteboard_history VALUES(?1,1,?2)",
            params![
                board,
                serde_json::json!({"elements":[{"image":r}]}).to_string()
            ],
        )
        .unwrap();
        gc(&c).unwrap();
        require(&c, &board, &r).unwrap();
        c.execute("DELETE FROM whiteboard_history", []).unwrap();
        gc(&c).unwrap();
        assert!(require(&c, &board, &r).is_err());
        store(&mut c, &board, 1, &r, &png).unwrap();
        c.execute("UPDATE whiteboards SET deleted=1 WHERE id=?1", [&board])
            .unwrap();
        gc(&c).unwrap();
        assert!(require(&c, &board, &r).is_err());
    }
}
