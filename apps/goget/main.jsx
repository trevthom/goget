import ReactDOM from "react-dom/client";
import App from "../../src/goget/App.jsx";
import "../../src/tailwind.css";
import "../../src/index.css";
import { applyAppearance } from "../../src/lib/appearance.js";
import { registerServiceWorker } from "../../src/lib/notify.js";

// Mounts GoGet into the page. (This file sits in the app's own folder
// so the dev server can serve it; the app itself lives in src/goget.)
// NOTE: React.StrictMode is intentionally NOT used here. In development
// StrictMode mounts every component twice, which makes Leaflet create
// and destroy each map twice and can crash the map. Leaving it off keeps
// the maps stable while you run `npm run dev`.
registerServiceWorker();
applyAppearance(); // light or dark, as saved on this device
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
