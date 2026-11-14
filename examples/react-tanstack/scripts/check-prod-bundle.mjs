// Verifies that a production build contains no warpstate runtime.
// Run after `vite build` (see the `check:prod` script).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const dist = new URL("../dist/assets/", import.meta.url).pathname;
// Strings that only exist in the real runtime packages.
const markers = [
  "OBSOLETE_SNAPSHOT", // @warpstate/core
  "Ignoring the `history` option", // @warpstate/tanstack-router
  "data-warpstate-overlay", // @warpstate/react
  "Capture warpstate snapshot", // @warpstate/webmcp
  "refetchOnReconnect:!1", // @warpstate/tanstack-query freeze
  "deflate-raw", // compact encoding
];

const files = (await readdir(dist)).filter((f) => f.endsWith(".js"));
let bytes = 0;
const leaks = [];
for (const file of files) {
  const code = await readFile(join(dist, file), "utf8");
  bytes += code.length;
  for (const marker of markers) if (code.includes(marker)) leaks.push(`${file}: ${marker}`);
}

console.log(`Checked ${files.length} files (${(bytes / 1024).toFixed(1)} KB of JS).`);
if (leaks.length) {
  console.error(`warpstate runtime found in the production bundle:\n  ${leaks.join("\n  ")}`);
  process.exit(1);
}
console.log("OK: no warpstate runtime in the production bundle.");
