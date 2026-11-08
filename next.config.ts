import type { NextConfig } from "next";
import path from "node:path";

const dev = process.env.NODE_ENV !== "production";

// Everything is served from this origin: no third-party scripts, fonts, images or frames. Next.js needs inline
// scripts/styles for hydration (and eval in dev for hot reload), so those are the only relaxations.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const config: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  serverExternalPackages: ["@napi-rs/canvas", "ffmpeg-static", "@ffprobe-installer/ffprobe"],
  // Binaries and the font are loaded by path at runtime, so tell the file tracer to ship them with the API routes.
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/@ffprobe-installer/linux-x64/**",
      "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf",
    ],
  },
  poweredByHeader: false,
  // Lets an isolated production build (e.g. for validation) live beside a running `next dev`.
  distDir: process.env.CVF_DIST_DIR || ".next",
  turbopack: { root: path.resolve(__dirname) },
};

export default config;
