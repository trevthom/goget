// Starts the apps for local development: rider on :5173, driver on :5174, GoGet on :5175.
// Open them in two browser windows to play both sides of a ride.
// Usage: npm run dev   (or npm run dev:rider / npm run dev:driver for one)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const procs = ["rider", "driver", "goget"].map((mode) =>
  spawn(process.execPath, [vite, "--mode", mode], { stdio: "inherit" })
);
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", (code) => { if (code) { stop(); process.exit(code); } }));
