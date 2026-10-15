// Tailwind CSS v3, built into a CSS file that the app hosts itself (no third-party script runs in the page: this is a
// wallet app, so a script from another site could read the keys). It is a normal build step through PostCSS (see
// vite.config.js). v3 is plain JavaScript: it has no native binary, which is why the older "no Tailwind in package.json"
// rule no longer applies. Do NOT use Tailwind v4 or @tailwindcss/vite (their native binary breaks on some machines).
//
// `content` lists every file whose class names must get CSS. A class name built from pieces ("bg-" + color) is NOT
// found by the scan: write each class out in full.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default {
  content: [`${root}/apps/**/*.{html,jsx}`, `${root}/src/**/*.{js,jsx}`],
  theme: { extend: {} },
  plugins: [],
};
