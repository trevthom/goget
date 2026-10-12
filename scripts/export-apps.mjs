// ════════════════════════════════════════════════════════════
//  EXPORT APPS — Makes the rider app and the driver app into two standalone
//  projects (each with its own package.json, build and tests) from this
//  repository, and can push them to their own GitHub repositories.
//
//  This repository stays the SOURCE OF TRUTH. The two exported repositories
//  are generated copies: change the code HERE, then run this script again.
//  (A hand edit in an exported repo is overwritten by the next export.)
//
//  Usage:
//    node scripts/export-apps.mjs                       # export to ../nostr-ride-export
//    node scripts/export-apps.mjs --out /some/folder    # export somewhere else
//    node scripts/export-apps.mjs --push                # also push to GitHub (main)
//    node scripts/export-apps.mjs --push --owner me     # GitHub owner (default: trevthom)
//    node scripts/export-apps.mjs --only rider          # one app only
//  Repository names: nostr-ride-rider and nostr-ride-driver.
// ════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const OUT = path.resolve(opt("--out", path.join(SRC, "..", "nostr-ride-export")));
const OWNER = opt("--owner", "trevthom");
const PUSH = args.includes("--push");
const ROLES = opt("--only") ? [opt("--only")] : ["rider", "driver"];

const read = (p) => fs.readFileSync(p, "utf8");
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const skip = (p) => /(^|[\\/])(node_modules|dist)([\\/]|$)/.test(p);
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, filter: (p) => !skip(p) });

const DESC = {
  rider: 'Uber/Lyft-style: "Where to?", fare quote, find a driver, watch the car arrive, start with a 2-digit code, pay the driver in ecash as the ride runs, finish the ride, rate.',
  driver: "Uber-Driver-style: GO online, incoming request cards, accept, navigate to pickup, arrive (within 50 m) / start code / finish the ride, ecash earnings.",
};
const GENERATED = (role) =>
  `> **Generated repository.** This is a copy of the ${role} app made from **${OWNER}/nostr-ride** by \`scripts/export-apps.mjs\`. Make changes in nostr-ride and export again: a hand edit here is overwritten by the next export.\n`;

function section(s, from, to) {
  const a = s.indexOf(from), b = to ? s.indexOf(to) : s.length;
  if (a < 0 || b < 0) throw new Error(`export: section not found: ${from}`);
  return [a, b];
}

function claudeMd(role, other, port) {
  let s = read(path.join(SRC, "CLAUDE.md"));
  let [a, b] = section(s, "## What this is", "## Architecture (data flow)");
  const otherPort = role === "rider" ? 5174 : 5173;
  s = s.slice(0, a) + `## What this is
NostrRide **${role === "rider" ? "Rider" : "Driver"} app** — one half of a decentralized ridesharing system. The rider and driver
apps are **separate repositories** that talk to each other only over **Nostr** (no server, no DB).
This repo is the **${role}** app: ${DESC[role]}
The sibling repo is **nostr-ride-${other}**. Both speak the same events (table below).

${GENERATED(role)}
Stack: **React 18 + Vite**. **Tailwind is loaded from a CDN** in \`index.html\`
(NOT a build dependency — do not add \`@tailwindcss/vite\` or \`tailwindcss\`
to package.json; its native binary breaks on some machines, which is why it was removed).
Full human-readable docs: \`docs/index.md\`.
Look: white UI, black buttons, bottom sheets over a full-screen map (Inter font).

## Commands
- \`npm install\` then \`npm run dev\` → http://localhost:${port}. To play a whole ride, also run the sibling app
  (nostr-ride-${other}, port ${otherPort}) and sign in with a different account in each.
- \`npm run build\` → \`dist/\` (static files; works from any folder: \`base: "./"\`). \`npm run preview\` serves it.
- \`npm test\` → Node's built-in test runner over \`test/*.test.mjs\` (no extra deps). Run it after touching \`lib/*\`, \`nostr/*\`.
- No linter configured.
- \`vite.config.js\` defines \`__APP_ROLE__\` (\`"${role}"\`), read through \`src/config/app.js\`.
  Node tests have no such constant and get \`"rider"\`.

` + s.slice(b);
  s = s.replace(/apps\/\n  rider\/  index\.html main\.jsx[\s\S]*?vite\.config\.js[^\n]*\n/,
    `index.html${role === "rider" ? "  track.html" : ""}  main.jsx${role === "rider" ? "  track.jsx" : ""}   # entry pages (Vite root is the repo root)\npublic/                           # manifest, icons, service worker (sw.js)\nvite.config.js                    # defines __APP_ROLE__, base "./"\n${role === "driver" ? "native/                           # Capacitor shell for background GPS (see native/README.md)\n" : ""}`);
  s = s.replace("- **Push everything to `main`** (the owner's standing instruction): commit on `main` and `git push origin main`. Do not leave work on side branches.\n", "");
  s = s.replace("- **Keep `docs/index.md` current**: when you change behavior, update the matching section and add a line to its changelog in the same commit.\n", "");
  s = s.replace("- The rider app must never import from `src/driver` and vice versa. Share via the folders above.\n",
    `- This repo is generated from ${OWNER}/nostr-ride: do not develop here. Fix the problem there and export again.\n`);
  s = s.replaceAll("`apps/*/public/sw.js`", "`public/sw.js`").replaceAll("(see apps/*/main.jsx)", "(see main.jsx)");
  s = s.replace("(apps/rider/track.html, built with the rider app)", role === "rider" ? "(`track.html`, built with this app)" : "(in the rider repo)");
  return s;
}

function docsMd(role, other, port) {
  let t = read(path.join(SRC, "docs/index.md"));
  const name = role === "rider" ? "Rider app" : "Driver app";
  t = t.replace("# NostrRide documentation", `# NostrRide ${name} documentation\n\n${GENERATED(role)}\n> This repository is the **${role}** app. The **${other}** app is in its own repository, **nostr-ride-${other}**. They share no server: they find each other through Nostr relays, so both use the same event formats (see [Nostr events](#nostr-events)).`);
  t = t.replace("## Quick start\n```bash\nnpm install\nnpm run dev        # rider http://localhost:5173 , driver http://localhost:5174\nnpm test           # automated checks\nnpm run build      # dist/rider and dist/driver\n```\nOpen the two apps in two browser windows and sign in with a different account in each.",
    `## Quick start\n\`\`\`bash\nnpm install\nnpm run dev        # http://localhost:${port}\nnpm test           # automated checks\nnpm run build      # dist/\n\`\`\`\nTo play a whole ride, also run the **${other}** app from its repository (port ${role === "rider" ? 5174 : 5173}) and sign in with a different account in each.`);
  t = t.replace("`npm run build` makes `dist/rider` and `dist/driver`. Put each on any static host (for example\n`ride.example.com` and `drive.example.com`).", "`npm run build` makes `dist/`. Put it on any static host (for example `ride.example.com`); it works from any sub-path.");
  t = t.replace("| | Rider app (`apps/rider`, `src/rider`) | Driver app (`apps/driver`, `src/driver`) |", "| | Rider app (repo nostr-ride-rider) | Driver app (repo nostr-ride-driver) |");
  t = t.replace("`npm run dev:rider` (or `dev:driver`)", "`npm run dev`").replace("Put `dist/rider` or `dist/driver` on", "Put `dist/` on");
  return t;
}

function readme(role, other, port) {
  const name = role === "rider" ? "Rider" : "Driver";
  return `# NostrRide ${name} app 🚗⚡

The **${role}** half of NostrRide, a decentralized ridesharing system on **Nostr**. The rider pays the driver in **ecash** (Cashu)
as the ride runs; **Lightning** and **NWC** fill and empty the ecash wallet. No central server, no database. ${DESC[role]}

The other half is in its own repository: **nostr-ride-${other}**. The two apps only talk through
Nostr relays, so they can be deployed separately.

${GENERATED(role)}
## Run it
\`\`\`bash
npm install
npm run dev     # http://localhost:${port}
npm test        # automated checks
npm run build   # static site in dist/
\`\`\`
Needs Node.js (LTS) and internet (Tailwind CDN, fonts, map, relays). Location needs \`https://\` or \`localhost\`.
To try a whole ride, run both apps and sign in with a different account in each.

## Try it on an iPhone (no Apple Developer Program)
Deploy \`dist/\` to any free https host, open it in Safari, then Share → **Add to Home Screen**. See
[\`docs/index.md\`](docs/index.md#trying-it-on-an-iphone-without-the-apple-developer-program).

## Docs
- [\`docs/index.md\`](docs/index.md): how it works, events, privacy, payments, safety, disputes, reliability, deploying, self-hosting maps.
- [\`CLAUDE.md\`](CLAUDE.md): file map and every invariant.
- \`env.example\`: use your own map, search and routing servers.
${role === "driver" ? "- `native/`: Capacitor shell for background GPS (untested on a device).\n" : ""}`;
}

function viteConfig(role, port) {
  const input = role === "rider" ? `
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        track: fileURLToPath(new URL("./track.html", import.meta.url)),
      },
      output: { manualChunks: { leaflet: ["leaflet"] } },
    },` : `
    rollupOptions: {
      output: { manualChunks: { leaflet: ["leaflet"] } },
    },`;
  return `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// "2026-10-12 21:30 UTC": the build time (shown in Account, so a person can tell which version is running).
const buildId = () => new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

// The ${role} app of NostrRide, as its own project (generated; see scripts/export-apps.mjs in nostr-ride).
// \`__APP_ROLE__\` is read in src/config/app.js. \`base: "./"\` lets the built
// files work from any folder or sub-path (GitHub Pages, Netlify, a plain server).
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: { __APP_ROLE__: JSON.stringify("${role}"), __BUILD_ID__: JSON.stringify(buildId()) },
  server: { port: ${port} },
  preview: { port: ${port - 1000} },
  build: {
    // The map library (Leaflet) is large; give it its own file.
    chunkSizeWarningLimit: 1500,${input}
  },
});
`;
}

function exportOne(role) {
  const other = role === "rider" ? "driver" : "rider";
  const port = role === "rider" ? 5173 : 5174;
  const d = path.join(OUT, `nostr-ride-${role}`);
  // Start clean but keep .git so a push is a normal commit on top of the last export.
  fs.mkdirSync(d, { recursive: true });
  for (const f of fs.readdirSync(d)) if (f !== ".git") fs.rmSync(path.join(d, f), { recursive: true, force: true });

  copy(path.join(SRC, "src"), path.join(d, "src"));
  fs.rmSync(path.join(d, "src", other), { recursive: true, force: true });
  copy(path.join(SRC, "test"), path.join(d, "test"));
  copy(path.join(SRC, "apps", role, "public"), path.join(d, "public"));
  for (const f of fs.readdirSync(path.join(SRC, "apps", role))) {
    const p = path.join(SRC, "apps", role, f);
    if (fs.statSync(p).isFile()) write(path.join(d, f), read(p).replaceAll("../../src/", "./src/"));
  }
  for (const f of ["env.example", ".gitignore"]) fs.copyFileSync(path.join(SRC, f), path.join(d, f));

  const pk = JSON.parse(read(path.join(SRC, "package.json")));
  pk.name = `nostr-ride-${role}`;
  pk.scripts = { dev: "vite", build: "vite build", preview: "vite preview", test: 'node --test "test/*.test.mjs"' };
  write(path.join(d, "package.json"), JSON.stringify(pk, null, 2) + "\n");
  const lock = JSON.parse(read(path.join(SRC, "package-lock.json")));
  lock.name = pk.name;
  if (lock.packages?.[""]) lock.packages[""].name = pk.name;
  write(path.join(d, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");

  write(path.join(d, "vite.config.js"), viteConfig(role, port));
  write(path.join(d, "CLAUDE.md"), claudeMd(role, other, port));
  write(path.join(d, "docs", "index.md"), docsMd(role, other, port));
  write(path.join(d, "README.md"), readme(role, other, port));

  if (role === "driver") {
    copy(path.join(SRC, "native"), path.join(d, "native"));
    const cfgPath = path.join(d, "native", "capacitor.config.json");
    write(cfgPath, JSON.stringify({ ...JSON.parse(read(cfgPath)), webDir: "../dist" }, null, 2) + "\n");
    const np = path.join(d, "native", "package.json");
    write(np, read(np).replace("cd .. && npm run build:driver && cd native && cap sync", "cd .. && npm run build && cd native && cap sync"));
    const nr = path.join(d, "native", "README.md");
    write(nr, read(nr).replaceAll("../dist/driver", "../dist"));
  }
  return d;
}

const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

function push(role, d) {
  const url = `https://github.com/${OWNER}/nostr-ride-${role}`;
  if (!fs.existsSync(path.join(d, ".git"))) { git(d, "init", "-q", "-b", "main"); git(d, "remote", "add", "origin", url); }
  try { git(d, "fetch", "-q", "origin", "main"); git(d, "reset", "-q", "--soft", "origin/main"); } catch { /* first push: the repository is empty */ }
  git(d, "add", "-A");
  if (!git(d, "status", "--porcelain")) { console.log(`${role}: nothing changed`); return; }
  const rev = git(SRC, "rev-parse", "--short", "HEAD");
  git(d, "commit", "-q", "-m", `Export from ${OWNER}/nostr-ride @ ${rev}\n\nGenerated by scripts/export-apps.mjs. Change the code in nostr-ride, not here.`);
  git(d, "push", "-q", "origin", "HEAD:main");
  console.log(`${role}: pushed to ${url} (main)`);
}

for (const role of ROLES) {
  const d = exportOne(role);
  console.log(`${role}: exported to ${d}`);
  if (PUSH) push(role, d);
}
