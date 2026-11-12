//! Fixed drawing code in a bounded embedded runtime; no JS filesystem/network bindings.
use crate::whiteboard::Scene;
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    time::{Duration, Instant},
};
const ROUGH: &str = include_str!("whiteboard_render/roughjs-4.6.6.cjs");
const CORE: &str = include_str!("../web/src/whiteboard-render-core.js");
const FONT: &[u8] = include_bytes!("../web/public/fonts/LiberationSans-Regular.ttf");
pub const ARTIFACT_LIMIT: usize = 8 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
impl Bounds {
    pub fn valid(&self) -> bool {
        [self.x, self.y, self.w, self.h]
            .iter()
            .all(|n| n.is_finite() && n.abs() <= 200_000.)
            && self.w > 0.
            && self.h > 0.
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Job {
    #[serde(default)]
    pub images: std::collections::BTreeMap<String, String>,
    pub scene: Scene,
    pub bounds: Option<Bounds>,
    pub theme: String,
    pub scale: f64,
}
#[derive(Serialize, Deserialize)]
pub(crate) struct Rendered {
    pub svg: String,
    pub png: String,
    pub width: u32,
    pub height: u32,
}
pub(crate) fn palette(theme: &str) -> Result<Value> {
    let all: Value = serde_json::from_str(include_str!("../web/src/theme-palettes.json"))?;
    let palette = all["themes"]
        .as_array()
        .context("Missing palettes")?
        .iter()
        .find(|p| p["colors"]["mode"] == theme)
        .context("Unknown theme")?;
    Ok(palette["colors"].clone())
}
pub(crate) fn render(job: &Job) -> Result<Rendered> {
    ensure!(job.theme == "light" || job.theme == "dark", "Invalid theme");
    ensure!(
        job.scale.is_finite() && (0.25..=4.).contains(&job.scale),
        "Invalid scale"
    );
    ensure!(
        job.scene.elements.len() <= 300
            && job
                .scene
                .elements
                .iter()
                .all(|e| crate::whiteboard::valid(&e.drawing)),
        "Invalid scene"
    );
    ensure!(
        job.bounds.as_ref().is_none_or(Bounds::valid),
        "Invalid bounds"
    );
    let mut image_bytes = 0usize;
    let mut image_pixels = 0u64;
    let mut allowed = std::collections::HashSet::new();
    for e in &job.scene.elements {
        if let Some(r) = &e.drawing.image {
            if allowed.contains(&r.id) {
                continue;
            }
            let value = job.images.get(&r.id).context("Missing stored image")?;
            let bytes = STANDARD.decode(
                value
                    .strip_prefix("data:image/png;base64,")
                    .context("Only stored PNG data allowed")?,
            )?;
            use sha2::{Digest, Sha256};
            ensure!(
                format!("{:x}", Sha256::digest(&bytes)) == r.id
                    && image::guess_format(&bytes)? == image::ImageFormat::Png,
                "Stored image digest/type mismatch"
            );
            let dims = image::ImageReader::with_format(
                std::io::Cursor::new(&bytes),
                image::ImageFormat::Png,
            )
            .into_dimensions()?;
            ensure!(
                dims == (r.width, r.height),
                "Stored image dimensions mismatch"
            );
            image_bytes += bytes.len();
            image_pixels += u64::from(r.width) * u64::from(r.height);
            ensure!(
                image_bytes <= crate::whiteboard_images::BYTE_LIMIT && image_pixels <= 16_000_000,
                "Stored image budget exceeded"
            );
            allowed.insert(r.id.clone());
        }
    }
    ensure!(job.images.len() == allowed.len(), "Unreferenced image data");
    let deadline = Instant::now() + Duration::from_secs(6);
    let rt = rquickjs::Runtime::new()?;
    rt.set_memory_limit(64 * 1024 * 1024);
    rt.set_max_stack_size(1024 * 1024);
    rt.set_interrupt_handler(Some(Box::new(move || Instant::now() > deadline)));
    let context = rquickjs::Context::full(&rt)?;
    let output:String=context.with(|ctx|->rquickjs::Result<String>{
  ctx.eval::<(),_>(format!("var rough=(function(){{var module={{exports:{{}}}};{ROUGH};return module.exports;}})();"))?;
  ctx.eval::<(),_>(CORE.replace("export function ","function "))?;
  let input=json!({"images":job.images,"items":job.scene.elements,"palette":palette(&job.theme).unwrap(),"bounds":job.bounds,"scale":job.scale,"font":if job.scene.elements.iter().any(|e|!e.drawing.text.is_empty()&&!matches!(e.drawing.kind.as_str(),"arrow"|"freehand")){STANDARD.encode(FONT)}else{String::new()}});
  ctx.globals().set("__input",serde_json::to_string(&input).unwrap())?;
  ctx.eval("(()=>{const j=JSON.parse(__input),b=j.bounds||drawingBounds(j.items),width=Math.ceil(b.w*j.scale),height=Math.ceil(b.h*j.scale);if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width>8192||height>8192||width*height>8000000)throw Error('Export exceeds pixel budget');return JSON.stringify({svg:sceneSVG(rough.generator(),j.items,j.palette,b,j.scale,j.font,j.images),width,height});})()")
 }).map_err(|_|anyhow::anyhow!("Drawing generation failed or exceeded its budget"))?;
    #[derive(Deserialize)]
    struct Svg {
        svg: String,
        width: u32,
        height: u32,
    }
    let result: Svg = serde_json::from_str(&output)?;
    ensure!(
        result.svg.len() <= ARTIFACT_LIMIT,
        "SVG exceeds output budget"
    );
    ensure!(Instant::now() < deadline, "Render deadline exceeded");
    let mut options = resvg::usvg::Options {
        font_family: "Liberation Sans".into(),
        image_href_resolver: resvg::usvg::ImageHrefResolver {
            resolve_data: Box::new(move |mime, bytes, _| {
                use sha2::{Digest, Sha256};
                if mime == "image/png"
                    && allowed.contains(&format!("{:x}", Sha256::digest(bytes.as_slice())))
                {
                    Some(resvg::usvg::ImageKind::PNG(bytes))
                } else {
                    None
                }
            }),
            resolve_string: Box::new(|_, _| None),
        },
        ..Default::default()
    };
    options.fontdb_mut().load_font_data(FONT.to_vec());
    options
        .fontdb_mut()
        .set_sans_serif_family("Liberation Sans");
    let tree = resvg::usvg::Tree::from_str(&result.svg, &options)?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(result.width, result.height)
        .context("PNG pixel budget unavailable")?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::identity(),
        &mut pixmap.as_mut(),
    );
    let png = pixmap.encode_png()?;
    ensure!(png.len() <= ARTIFACT_LIMIT, "PNG exceeds output budget");
    ensure!(Instant::now() < deadline, "Render deadline exceeded");
    Ok(Rendered {
        svg: result.svg,
        png: STANDARD.encode(png),
        width: result.width,
        height: result.height,
    })
}
/// Private subprocess protocol. Runs before service initialization/listeners.
pub fn worker_main() -> Result<()> {
    let mut input = Vec::new();
    std::io::stdin()
        .take(12 * 1024 * 1024 + 1)
        .read_to_end(&mut input)?;
    ensure!(
        input.len() <= 12 * 1024 * 1024,
        "Render input exceeded budget"
    );
    let job: Job = serde_json::from_slice(&input)?;
    let result = render(&job)?;
    std::io::stdout().write_all(&serde_json::to_vec(&result)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn job() -> Job {
        let id = uuid::Uuid::new_v4().to_string();
        let scene:Scene=serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"name":"Fixture","revision":1,"metadata_revision":"metadata","ticket":null,"updated_at":1,"elements":[{"id":id,"revision":"revision","kind":"rectangle","x":0,"y":0,"w":180,"h":90,"text":"<script> & hello","color":"accent","seed":7,"clean":false,"author":"fixture","created_by":"fixture","updated_at":1}]})).unwrap();
        Job {
            images: Default::default(),
            scene,
            bounds: None,
            theme: "dark".into(),
            scale: 1.,
        }
    }
    #[test]
    fn renders_deterministic_seeded_paths_and_embedded_font() {
        let a = render(&job()).unwrap();
        assert!(a.svg.contains("&lt;script&gt; &amp; hello"));
        assert!(!a.svg.contains("<script>"));
        assert!(a.svg.contains("data:font/ttf;base64,"));
        let mut same = job();
        same.scene.elements[0].id = "stable".into();
        let b = render(&same).unwrap();
        let c = render(&same).unwrap();
        assert_eq!(b.svg, c.svg);
        assert_eq!(b.png, c.png);
        assert!(
            STANDARD
                .decode(a.png)
                .unwrap()
                .starts_with(b"\x89PNG\r\n\x1a\n")
        );
    }
    #[test]
    fn clean_and_rough_modes_differ_and_raster_dimensions_scale() {
        let mut scene = job();
        let rough = render(&scene).unwrap();
        scene.scene.elements[0].drawing.clean = true;
        scene.scale = 2.;
        let clean = render(&scene).unwrap();
        assert_ne!(rough.svg, clean.svg);
        assert_eq!(
            (rough.width * 2, rough.height * 2),
            (clean.width, clean.height)
        );
        let png = STANDARD.decode(clean.png).unwrap();
        let image = resvg::tiny_skia::Pixmap::decode_png(&png).unwrap();
        assert_eq!((image.width(), image.height()), (clean.width, clean.height));
        assert_eq!(image.pixel(0, 0).unwrap().alpha(), 255);
    }
    #[test]
    fn stored_images_render_pixels_and_reject_external_or_tampered_sources() {
        use sha2::{Digest, Sha256};
        let mut j = job();
        let mut bytes = std::io::Cursor::new(vec![]);
        image::RgbaImage::from_pixel(32, 16, image::Rgba([250, 10, 20, 255]))
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let bytes = bytes.into_inner();
        let id = format!("{:x}", Sha256::digest(&bytes));
        let d = &mut j.scene.elements[0].drawing;
        d.kind = "image".into();
        d.text.clear();
        d.x = 0.;
        d.y = 0.;
        d.w = 64.;
        d.h = 32.;
        d.image = Some(crate::whiteboard_images::ImageRef {
            id: id.clone(),
            width: 32,
            height: 16,
        });
        j.images.insert(
            id.clone(),
            format!("data:image/png;base64,{}", STANDARD.encode(&bytes)),
        );
        j.bounds = Some(Bounds {
            x: 0.,
            y: 0.,
            w: 64.,
            h: 32.,
        });
        j.scale = 2.;
        let rendered = render(&j).unwrap();
        assert!(rendered.svg.contains("<image"));
        assert!(rendered.svg.contains("data:image/png;base64,"));
        let png = STANDARD.decode(rendered.png).unwrap();
        let pixels = resvg::tiny_skia::Pixmap::decode_png(&png).unwrap();
        let pixel = pixels.pixel(64, 32).unwrap();
        assert_eq!((pixel.red(), pixel.green(), pixel.blue()), (250, 10, 20));
        j.images
            .insert(id.clone(), "https://example.org/private.png".into());
        assert!(render(&j).is_err());
        j.images.insert(id, "data:image/png;base64,AA==".into());
        assert!(render(&j).is_err());
    }
    #[test]
    fn oversized_pixels_invalid_scale_and_geometry_fail_closed() {
        let mut scene = job();
        scene.bounds = Some(Bounds {
            x: 0.,
            y: 0.,
            w: 100000.,
            h: 100000.,
        });
        assert!(render(&scene).is_err());
        scene.bounds = None;
        scene.scale = f64::NAN;
        assert!(render(&scene).is_err());
        scene.scale = 1.;
        scene.scene.elements[0].drawing.x = f64::INFINITY;
        assert!(render(&scene).is_err());
    }
}
