import { existsSync } from "node:fs";
import { GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";

const FONT_CANDIDATES = [
  process.env.FONT_PATH ?? "",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "C:\\Windows\\Fonts\\arialbd.ttf",
].filter(Boolean);

const FAMILY = "CFSans";
let resolved: string | null | undefined;

/** Path of the font used for overlays (registered once), or null if falling back to the default sans. */
export function fontPath(): string | null {
  if (resolved !== undefined) return resolved;
  resolved = null;
  for (const candidate of FONT_CANDIDATES) {
    if (existsSync(candidate) && GlobalFonts.registerFromPath(candidate, FAMILY)) {
      resolved = candidate;
      break;
    }
  }
  return resolved;
}

export const font = (size: number): string => {
  fontPath();
  return `700 ${size}px ${resolved ? FAMILY : "sans-serif"}`;
};

function breakWord(ctx: SKRSContext2D, word: string, maxWidth: number): string[] {
  const parts: string[] = [];
  let current = "";
  for (const ch of Array.from(word)) {
    if (current && ctx.measureText(current + ch).width > maxWidth) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function wrap(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const pieces = ctx.measureText(word).width > maxWidth ? breakWord(ctx, word, maxWidth) : [word];
    for (const piece of pieces) {
      const candidate = line ? `${line} ${piece}` : piece;
      if (!line || ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = piece;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface FittedText {
  lines: string[];
  size: number;
  lineHeight: number;
  width: number;
  height: number;
}

/** Shrinks the font until the text fits in maxLines; truncates with an ellipsis only at the minimum size. */
export function fitText(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number, maxSize: number, minSize: number): FittedText {
  const clean = text.replace(/\s+/g, " ").trim();
  let size = maxSize;
  let lines: string[] = [];
  for (; size >= minSize; size -= 2) {
    ctx.font = font(size);
    lines = wrap(ctx, clean, maxWidth);
    if (lines.length <= maxLines) break;
  }
  size = Math.max(size, minSize);
  ctx.font = font(size);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1] ?? "";
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  const lineHeight = Math.round(size * 1.18);
  const width = Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
  return { lines, size, lineHeight, width, height: lines.length * lineHeight };
}

export function drawLines(
  ctx: SKRSContext2D,
  fitted: FittedText,
  x: number,
  top: number,
  align: "left" | "center",
): void {
  ctx.font = font(fitted.size);
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  fitted.lines.forEach((line, i) => {
    ctx.fillText(line, x, top + i * fitted.lineHeight + fitted.size);
  });
}
