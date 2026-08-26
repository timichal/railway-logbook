import { mkdirSync } from "node:fs";
import sharp from "sharp";

/**
 * Renders the home-screen icon set from one master image.
 *
 * The master (`assets/app-icon.png`) is the original transparent artwork: a wide
 * train that fills the full width of a 180x180 square and is empty above and
 * below it. Every output below is that art re-composited, because the three
 * places an icon lands want three different framings and only one of them is the
 * master's own:
 *
 * - **`apple-icon`** — iOS composites a transparent home-screen icon onto
 *   **black**, which is why the master cannot be shipped as-is: the pale grey
 *   train body would sit on a black tile. It gets the white ground the art was
 *   drawn against, and the size Apple asks for.
 * - **`icon-192` / `icon-512`** (manifest `purpose: "any"`) — shown as given, so
 *   they carry the same white ground and a little breathing room at the edges.
 * - **`icon-maskable-512`** (`purpose: "maskable"`) — the launcher crops this to
 *   the device's own icon shape, and the only region it guarantees to keep is a
 *   centred circle 80% of the canvas wide. The art is scaled so its *diagonal*
 *   fits that circle, which is what "safe zone" means for a landscape image; a
 *   maskable icon must also be edge-to-edge opaque, since whatever it does keep
 *   is all there is.
 *
 * The master is 180px, so the 512s are an upscale. Lanczos on flat vector-style
 * artwork holds up; if the art is ever redrawn, redraw it large and this script
 * needs no changes.
 *
 * Outputs are committed — this runs by hand (`npm run generateAppIcons`) when the
 * artwork changes, not on every build.
 */
const MASTER = "assets/app-icon.png";
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/** Android's guaranteed-visible region: a centred circle 80% of the canvas wide. */
const MASKABLE_SAFE_ZONE = 0.8;
/** How much of the canvas the art spans on the icons shown uncropped. */
const PLAIN_ART_WIDTH = 0.9;

type Target = { path: string; canvas: number; artWidth: number };

async function render({ path, canvas, artWidth }: Target): Promise<void> {
  const art = await sharp(MASTER)
    // The master's transparent top and bottom bands are padding, not artwork, and
    // would otherwise be measured as part of it.
    .trim({ threshold: 1 })
    .resize({ width: artWidth, kernel: "lanczos3" })
    .toBuffer();

  await sharp({
    create: { width: canvas, height: canvas, channels: 4, background: WHITE },
  })
    .composite([{ input: art, gravity: "centre" }])
    .png()
    .toFile(path);

  console.log(`Wrote ${path} (${canvas}x${canvas}, art ${artWidth}px wide)`);
}

/**
 * The widest the art can be drawn on `canvas` and still fit inside the maskable
 * safe circle — the art's diagonal is what has to fit, not its width.
 */
function maskableArtWidth(canvas: number, aspect: number): number {
  const diameter = canvas * MASKABLE_SAFE_ZONE;
  return Math.round(diameter / Math.sqrt(1 + aspect ** 2));
}

async function main(): Promise<void> {
  const { width, height } = await sharp(MASTER).trim({ threshold: 1 }).metadata();
  if (!width || !height) throw new Error(`Could not read ${MASTER}`);
  const aspect = height / width;

  mkdirSync("public", { recursive: true });

  const targets: Target[] = [
    { path: "src/app/apple-icon.png", canvas: 180, artWidth: Math.round(180 * PLAIN_ART_WIDTH) },
    { path: "public/icon-192.png", canvas: 192, artWidth: Math.round(192 * PLAIN_ART_WIDTH) },
    { path: "public/icon-512.png", canvas: 512, artWidth: Math.round(512 * PLAIN_ART_WIDTH) },
    { path: "public/icon-maskable-512.png", canvas: 512, artWidth: maskableArtWidth(512, aspect) },
  ];

  for (const target of targets) await render(target);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
