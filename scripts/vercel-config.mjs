#!/usr/bin/env node
// Writes vercel.json for the Eve UI: the static build, and the application's API paths forwarded to eve-runtime.
// Usage: EVE_RUNTIME_ORIGIN=https://eve-runtime.example.com node scripts/vercel-config.mjs
import { writeFileSync } from "node:fs";

const origin = process.env.EVE_RUNTIME_ORIGIN;
if (!origin || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) {
  console.error("Set EVE_RUNTIME_ORIGIN to eve-runtime's public HTTPS origin, e.g. https://eve-runtime.example.com (no path).");
  process.exit(1);
}
const forward = ["/api/:path*", "/eve/:path*", "/appport/:path*"].map((source) => ({ source, destination: `${origin}${source}` }));
const config = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  buildCommand: "npx vite build",
  outputDirectory: "dist",
  framework: null,
  rewrites: [...forward, { source: "/((?!assets/).*)", destination: "/index.html" }],
  headers: [{ source: "/(.*)", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "same-origin" }] }],
};
writeFileSync(new URL("../vercel.json", import.meta.url), `${JSON.stringify(config, null, 2)}\n`);
console.log(`vercel.json: /api, /eve, /appport → ${origin}`);
