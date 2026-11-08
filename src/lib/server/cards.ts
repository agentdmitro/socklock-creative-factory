import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { OUTPUT, type FitMode, type TemplateId } from "@/lib/types";
import { drawLines, fitText } from "./text";

const W = OUTPUT.width;
const H = OUTPUT.height;
/** Mobile safe area: clear of Reels/TikTok/Shorts UI at the top and bottom. */
export const SAFE = { x: 56, top: 150, bottom: 960 } as const;
/** Region where the demo footage is placed (inside the safe area). */
export const DEMO_WINDOW = { y: 260, h: 700 } as const;
const TEXT_W = W - SAFE.x * 2;

interface Theme {
  bg: string;
  fg: string;
  accent: string;
  accentFg: string;
  align: "left" | "center";
}

const THEMES: Record<TemplateId, Theme> = {
  statement: { bg: "#14161A", fg: "#FFFFFF", accent: "#C8F169", accentFg: "#14161A", align: "center" },
  editorial: { bg: "#F3EEE6", fg: "#1D1B18", accent: "#E4572E", accentFg: "#FFFFFF", align: "left" },
  spotlight: { bg: "#2646E6", fg: "#FFFFFF", accent: "#FFFFFF", accentFg: "#2646E6", align: "center" },
};

const DEMO_BG: Record<TemplateId, string> = { statement: "#14161A", editorial: "#F3EEE6", spotlight: "#0B1230" };

function canvas() {
  const c = createCanvas(W, H);
  return { c, ctx: c.getContext("2d") };
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function textX(align: "left" | "center") {
  return align === "left" ? SAFE.x : W / 2;
}

/** Cheap, reliable blur: scale the image down, then back up with smoothing. */
function drawBlurredCover(ctx: SKRSContext2D, img: Image) {
  const tiny = createCanvas(24, Math.max(2, Math.round((24 * H) / W)));
  const tctx = tiny.getContext("2d");
  tctx.imageSmoothingEnabled = true;
  const s = Math.max(tiny.width / img.width, tiny.height / img.height);
  tctx.drawImage(img, (tiny.width - img.width * s) / 2, (tiny.height - img.height * s) / 2, img.width * s, img.height * s);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tiny, 0, 0, W, H);
}

function drawImageFit(ctx: SKRSContext2D, img: Image, x: number, y: number, w: number, h: number, fit: FitMode) {
  const s = fit === "cover" ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function accentBar(ctx: SKRSContext2D, t: Theme, x: number, y: number) {
  ctx.fillStyle = t.accent;
  roundRect(ctx, x, y, 72, 8, 4);
  ctx.fill();
}

/** Smaller supporting line under the hook: the concept's opening line, shown as a subtitle. */
const SUB_GAP = 28;

export async function hookCard(t: TemplateId, hook: string, opening: string, stillPath: string, fit: FitMode): Promise<Buffer> {
  const theme = THEMES[t];
  const { c, ctx } = canvas();
  const still = await loadImage(stillPath);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  if (t === "statement") {
    const fitted = fitText(ctx, hook, TEXT_W, 5, 92, 48);
    const sub = opening ? fitText(ctx, opening, TEXT_W, 3, 38, 26) : null;
    const top = (SAFE.top + SAFE.bottom) / 2 - (fitted.height + (sub ? SUB_GAP + sub.height : 0)) / 2;
    accentBar(ctx, theme, W / 2 - 36, top - 48);
    ctx.fillStyle = theme.fg;
    drawLines(ctx, fitted, W / 2, top, "center");
    if (sub) {
      ctx.fillStyle = "rgba(255,255,255,0.74)";
      drawLines(ctx, sub, W / 2, top + fitted.height + SUB_GAP, "center");
    }
  } else if (t === "editorial") {
    const fitted = fitText(ctx, hook, TEXT_W, 4, 76, 44);
    accentBar(ctx, theme, SAFE.x, SAFE.top);
    ctx.fillStyle = theme.fg;
    drawLines(ctx, fitted, SAFE.x, SAFE.top + 40, "left");
    const sub = opening ? fitText(ctx, opening, TEXT_W, 3, 34, 24) : null;
    let below = SAFE.top + 40 + fitted.height;
    if (sub) {
      ctx.fillStyle = "#6F675C";
      drawLines(ctx, sub, SAFE.x, below + SUB_GAP, "left");
      below += SUB_GAP + sub.height;
    }
    const cardTop = Math.max(below + 48, 520);
    const cardH = SAFE.bottom - cardTop;
    ctx.save();
    roundRect(ctx, SAFE.x, cardTop, TEXT_W, cardH, 28);
    ctx.clip();
    ctx.fillStyle = "#E4DCCF";
    ctx.fillRect(SAFE.x, cardTop, TEXT_W, cardH);
    drawImageFit(ctx, still, SAFE.x, cardTop, TEXT_W, cardH, fit);
    ctx.restore();
  } else {
    if (fit === "cover") drawImageFit(ctx, still, 0, 0, W, H, "cover");
    else {
      drawBlurredCover(ctx, still);
      drawImageFit(ctx, still, 0, 0, W, H, "contain");
    }
    ctx.fillStyle = "rgba(8, 12, 40, 0.58)";
    ctx.fillRect(0, 0, W, H);
    const fitted = fitText(ctx, hook, TEXT_W, 5, 84, 46);
    const sub = opening ? fitText(ctx, opening, TEXT_W, 3, 36, 26) : null;
    const blockH = fitted.height + (sub ? SUB_GAP + sub.height : 0);
    const top = (SAFE.top + SAFE.bottom) / 2 - blockH / 2;
    ctx.fillStyle = theme.fg;
    drawLines(ctx, fitted, W / 2, top, "center");
    if (sub) {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      drawLines(ctx, sub, W / 2, top + fitted.height + SUB_GAP, "center");
    }
    accentBar(ctx, theme, W / 2 - 36, top + blockH + 36);
  }
  return c.toBuffer("image/png");
}

export function demoBackdrop(t: TemplateId, caption: string): Buffer {
  const theme = THEMES[t];
  const { c, ctx } = canvas();
  ctx.fillStyle = DEMO_BG[t];
  ctx.fillRect(0, 0, W, H);
  const fitted = fitText(ctx, caption, TEXT_W, 2, 44, 30);
  const top = SAFE.top + (DEMO_WINDOW.y - SAFE.top - 40 - fitted.height) / 2;
  ctx.fillStyle = t === "statement" || t === "spotlight" ? "#FFFFFF" : theme.fg;
  drawLines(ctx, fitted, textX(theme.align), top, theme.align);
  ctx.fillStyle = t === "spotlight" ? "#7C93FF" : theme.accent;
  const barY = DEMO_WINDOW.y + DEMO_WINDOW.h + 24;
  roundRect(ctx, theme.align === "left" ? SAFE.x : W / 2 - 36, barY, 72, 8, 4);
  ctx.fill();
  return c.toBuffer("image/png");
}

export function ctaCard(t: TemplateId, brand: string, cta: string): Buffer {
  const theme = THEMES[t];
  const { c, ctx } = canvas();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  const align = theme.align;
  const x = textX(align);

  const label = fitText(ctx, brand.toUpperCase(), TEXT_W, 1, 30, 20);
  const padX = 44;
  const padY = 34;
  const btn = fitText(ctx, cta, TEXT_W - padX * 2, 3, 62, 36);
  const btnW = Math.min(TEXT_W, Math.max(btn.width + padX * 2, 280));
  const btnH = btn.height + padY * 2;
  const blockH = label.height + 44 + btnH;
  const top = (SAFE.top + SAFE.bottom) / 2 - blockH / 2;

  ctx.fillStyle = t === "editorial" ? "#6F675C" : "rgba(255,255,255,0.72)";
  drawLines(ctx, label, x, top, align);

  const btnX = align === "left" ? SAFE.x : (W - btnW) / 2;
  const btnY = top + label.height + 44;
  ctx.fillStyle = theme.accent;
  roundRect(ctx, btnX, btnY, btnW, btnH, Math.min(btnH / 2, 56));
  ctx.fill();
  ctx.fillStyle = theme.accentFg;
  drawLines(ctx, btn, btnX + btnW / 2, btnY + padY, "center");
  return c.toBuffer("image/png");
}
