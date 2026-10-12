// A minimal NIP-01 relay for the E2E run (memory only). Strict about the one thing that bit this repo before:
// a REQ filter must be a plain object, never an array.
import { WebSocketServer } from "ws";

export function startRelay(port = 0) {
  const events = [];
  const subs = new Set(); // { ws, id, filters }
  const wss = new WebSocketServer({ port, host: "127.0.0.1" });
  const tagVals = (e, name) => e.tags.filter((t) => t[0] === name).map((t) => t[1]);
  const match = (e, f) => {
    if (f.ids && !f.ids.includes(e.id)) return false;
    if (f.authors && !f.authors.includes(e.pubkey)) return false;
    if (f.kinds && !f.kinds.includes(e.kind)) return false;
    if (f.since && e.created_at < f.since) return false;
    if (f.until && e.created_at > f.until) return false;
    for (const k of Object.keys(f)) if (k[0] === "#") { const v = tagVals(e, k.slice(1)); if (!f[k].some((x) => v.includes(x))) return false; }
    return true;
  };
  const replaceable = (k) => k === 0 || k === 3 || (k >= 10000 && k < 20000) || (k >= 30000 && k < 40000);
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m[0] === "EVENT") {
        const e = m[1];
        if (!e || typeof e.id !== "string") return ws.send(JSON.stringify(["OK", "", false, "invalid"]));
        if (events.some((x) => x.id === e.id)) return ws.send(JSON.stringify(["OK", e.id, true, "duplicate"]));
        const eph = e.kind >= 20000 && e.kind < 30000;
        if (!eph) {
          if (replaceable(e.kind)) {
            const d = tagVals(e, "d")[0] ?? "";
            const i = events.findIndex((x) => x.kind === e.kind && x.pubkey === e.pubkey && (tagVals(x, "d")[0] ?? "") === d);
            if (i >= 0) { if (events[i].created_at > e.created_at) return ws.send(JSON.stringify(["OK", e.id, true, "older"])); events.splice(i, 1); }
          }
          events.push(e);
        }
        ws.send(JSON.stringify(["OK", e.id, true, ""]));
        for (const s of subs) if (s.filters.some((f) => match(e, f))) s.ws.send(JSON.stringify(["EVENT", s.id, e]));
      } else if (m[0] === "REQ") {
        const [, id, ...filters] = m;
        if (!filters.length || filters.some((f) => !f || typeof f !== "object" || Array.isArray(f))) return ws.send(JSON.stringify(["CLOSED", id, "invalid: filters must be objects"]));
        subs.add({ ws, id, filters });
        for (const e of events) if (filters.some((f) => match(e, f))) ws.send(JSON.stringify(["EVENT", id, e]));
        ws.send(JSON.stringify(["EOSE", id]));
      } else if (m[0] === "CLOSE") {
        for (const s of subs) if (s.ws === ws && s.id === m[1]) subs.delete(s);
      }
    });
    ws.on("close", () => { for (const s of subs) if (s.ws === ws) subs.delete(s); });
  });
  return new Promise((resolve) => wss.on("listening", () => resolve({
    url: `ws://127.0.0.1:${wss.address().port}`,
    events,
    inject: (e) => { events.push(e); for (const s of subs) if (s.filters.some((f) => match(e, f))) s.ws.send(JSON.stringify(["EVENT", s.id, e])); },
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(r); }),
  })));
}
