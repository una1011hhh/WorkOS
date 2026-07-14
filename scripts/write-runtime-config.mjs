import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const publicConfig = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "",
};

const outputPath = join(process.cwd(), "public", "workos-runtime-config.js");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `window.__WORKOS_RUNTIME_CONFIG__ = ${JSON.stringify(publicConfig)};\n`,
  "utf8",
);
