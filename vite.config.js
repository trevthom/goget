import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { cspPlugin } from "./csp.mjs";

// "2026-10-12 21:30 UTC · 9dbe842": the build time, and the commit when git is available (a host without git shows only the time).
const buildId = () => {
  let sha = "";
  try { sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* no git here */ }
  return new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC" + (sha ? " · " + sha : "");
};

// One repo, three apps. The Vite "mode" picks which one:
//   vite --mode rider    → apps/rider  (port 5173, builds to dist/rider)
//   vite --mode driver   → apps/driver (port 5174, builds to dist/driver)
//   vite --mode goget    → apps/goget  (port 5175, builds to dist/goget): GoGet, all four contexts in one app
// All share the code in src/ (Nostr protocol, libs, UI kit); each has its
// own entry page, screens, and build output, so they deploy independently.
// `__APP_ROLE__` is replaced at build time (see src/config/app.js).
export default defineConfig(({ mode }) => {
  const role = mode === "driver" ? "driver" : mode === "goget" ? "goget" : "rider";
  return {
    root: `apps/${role}`,
    envDir: fileURLToPath(new URL(".", import.meta.url)), // .env lives at the repo root
    plugins: [react(), cspPlugin()],
    // Tailwind CSS v3 is built into the app's own CSS (src/tailwind.css); no script from a CDN runs in the page.
    css: { postcss: { plugins: [tailwindcss(fileURLToPath(new URL("./tailwind.config.js", import.meta.url))), autoprefixer()] } },
    define: { __APP_ROLE__: JSON.stringify(role), __BUILD_ID__: JSON.stringify(buildId()) },
    server: {
      port: { driver: 5174, goget: 5175 }[role] || 5173,
      // The pages live in apps/<role> but import from the repo's src/.
      fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] },
    },
    preview: { port: { driver: 4174, goget: 4175 }[role] || 4173 },
    build: {
      outDir: `../../dist/${role}`,
      emptyOutDir: true,
      // The map library (Leaflet) is large; give it its own file so
      // it's cached separately and doesn't bloat the main bundle.
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        // The rider app and GoGet also ship the "follow a shared trip" page (track.html).
        input: role === "rider" || role === "goget"
          ? {
              index: fileURLToPath(new URL(`./apps/${role}/index.html`, import.meta.url)),
              track: fileURLToPath(new URL(`./apps/${role}/track.html`, import.meta.url)),
            }
          : undefined,
        output: {
          manualChunks: {
            leaflet: ["leaflet"],
          },
        },
      },
    },
  };
});
