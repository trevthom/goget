// A small stand-in for the Strike API (https://docs.strike.me), for tests and the browser run. It is NOT Strike: it follows the public
// reference (paths, headers, fields) as far as lib/strike.js uses it, and does honest arithmetic, so the client and the flows built on
// it can be tested with no network and no money. Where this file and live Strike differ, live Strike wins (see docs/index.md, "Strike").
//
//   const strike = await startLocalStrike({ apiKey: "k", usdPerBtc: 100000, balances: { BTC: 0.01, USD: 500 } })
//   strike.url                       http://127.0.0.1:<port>
//   strike.onPay = (invoice) => …    called when a payment quote is executed (a test uses it to mark a mint invoice paid)
//   strike.stats                     { quotes, payments, invoices } — what the client asked for
//   strike.balances                  { BTC, USD } — debited by payments
//   options: scopes (the key's permissions; null = all), quoteTtlMs, failPayments, invoiceable (currencies), skew (invoice sats × skew)
import http from "node:http";
import { randomUUID } from "node:crypto";
import { invoiceFor } from "./localmint.mjs";

const R = new URL("../../src", import.meta.url).pathname;
const { invoiceAmountMsat } = await import(`${R}/lib/lnurl.js`);
const { satsToBtc, btcToSats, SCOPES } = await import(`${R}/lib/strike.js`);

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

export async function startLocalStrike({ apiKey = "test-api-key-0123456789", scopes = null, usdPerBtc = 100000, balances = { BTC: 0.01, USD: 500 }, quoteTtlMs = 30000, failPayments = false, invoiceable = ["BTC", "USD"], skew = 1 } = {}) {
  const bal = { ...balances };
  const stats = { quotes: [], payments: [], invoices: [], keys: [] };
  const quotes = new Map(), payments = new Map(), invoices = new Map();
  const api = { balances: bal, stats, onPay: () => {}, failPayments, skew, usdPerBtc };

  // Paying a quote of `sats` costs the sats plus a 1 sat network fee; dollars carry a 0.5% spread.
  const cost = (sats, source) => (source === "BTC" ? { amount: satsToBtc(sats + 1), currency: "BTC" } : { amount: (Math.ceil((sats + 1) / 1e8 * api.usdPerBtc * 1.005 * 100) / 100).toFixed(2), currency: source });

  const need = (scope) => { if (scopes && !scopes.includes(scope)) throw fail(403, "FORBIDDEN", "Missing scope " + scope); };
  const routes = [
    ["GET", /^\/v1\/balances$/, () => {
      need(SCOPES.balances);
      return Object.entries(bal).map(([currency, n]) => { const a = currency === "BTC" ? n.toFixed(8) : n.toFixed(2); return { currency, current: a, pending: "0", reserved: "0", available: a, outgoing: "0", total: a }; });
    }],
    ["POST", /^\/v1\/payment-quotes\/lightning$/, (b, h) => {
      need(SCOPES.quote);
      if (!h["idempotency-key"]) throw fail(400, "INVALID_DATA", "The idempotency-key header is required");
      stats.keys.push(h["idempotency-key"]);
      if (![...quotes.values()].every((q) => q.key !== h["idempotency-key"])) throw fail(409, "DUPLICATE_PAYMENT_QUOTE", "Duplicate quote");
      const msat = invoiceAmountMsat(b.lnInvoice);
      if (msat == null) throw fail(400, "INVALID_DATA", "Invoice has no amount");
      const sats = msat / 1000, source = b.sourceCurrency || "BTC";
      if (!(source in bal)) throw fail(400, "INVALID_DATA", "Unknown source currency");
      const id = randomUUID();
      const q = { id, key: h["idempotency-key"], invoice: b.lnInvoice, sats, source, total: cost(sats, source), validUntil: Date.now() + quoteTtlMs, executed: false };
      quotes.set(id, q);
      stats.quotes.push({ id, sats, source });
      return {
        paymentQuoteId: id, validUntil: new Date(q.validUntil).toISOString(),
        conversionRate: { amount: String(api.usdPerBtc), sourceCurrency: source, targetCurrency: "BTC" },
        amount: { amount: satsToBtc(sats), currency: "BTC" }, lightningNetworkFee: { amount: satsToBtc(1), currency: "BTC" }, totalAmount: q.total,
      };
    }],
    ["PATCH", /^\/v1\/payment-quotes\/([^/]+)\/execute$/, (b, h, m) => {
      need(SCOPES.execute);
      const q = quotes.get(m[1]);
      if (!q) throw fail(404, "NOT_FOUND", "No such quote");
      if (q.executed) throw fail(409, "ALREADY_EXECUTED", "This quote was already executed");
      if (Date.now() > q.validUntil) throw fail(400, "QUOTE_EXPIRED", "The quote has expired");
      const price = Number(q.total.amount);
      if (bal[q.source] < price) throw fail(400, "INSUFFICIENT_FUNDS", "Not enough funds in your " + q.source + " balance");
      q.executed = true;
      bal[q.source] -= price;
      const p = { paymentId: randomUUID(), sats: q.sats, source: q.source, invoice: q.invoice };
      payments.set(p.paymentId, p);
      stats.payments.push({ id: p.paymentId, sats: q.sats, source: q.source, paid: q.total });
      if (!api.failPayments) api.onPay(q.invoice, q);
      return { paymentId: p.paymentId, state: "PENDING" };
    }],
    ["GET", /^\/v1\/payments\/([^/]+)$/, (b, h, m) => {
      need(SCOPES.payment);
      if (!payments.get(m[1])) throw fail(404, "NOT_FOUND", "No such payment");
      return api.failPayments ? { paymentId: m[1], state: "FAILED" } : { paymentId: m[1], state: "COMPLETED" };
    }],
    ["POST", /^\/v1\/invoices$/, (b) => {
      need(SCOPES.invoice);
      const a = b.amount || {};
      if (!invoiceable.includes(a.currency)) throw fail(400, "INVALID_DATA", `Your account cannot create invoices in ${a.currency}`);
      if (!(Number(a.amount) > 0)) throw fail(400, "INVALID_DATA", "The amount must be above zero");
      const id = randomUUID();
      invoices.set(id, { id, amount: a, description: b.description });
      stats.invoices.push({ id, amount: a, description: b.description });
      return { invoiceId: id, amount: a, state: "UNPAID", description: b.description, correlationId: b.correlationId };
    }],
    ["POST", /^\/v1\/invoices\/([^/]+)\/quote$/, (b, h, m) => {
      need(SCOPES.invoiceQuote);
      const inv = invoices.get(m[1]);
      if (!inv) throw fail(404, "NOT_FOUND", "No such invoice");
      const a = inv.amount;
      const sats = Math.round((a.currency === "BTC" ? btcToSats(a.amount) : (Number(a.amount) / api.usdPerBtc) * 1e8) * api.skew);
      inv.sats = sats;
      return { quoteId: randomUUID(), lnInvoice: invoiceFor(sats, "strikeinvoice"), expirationInSec: 3600, targetAmount: a, sourceAmount: { amount: satsToBtc(sats), currency: "BTC" } };
    }],
  ];

  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type,idempotency-key", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS" };
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json", ...cors }); res.end(JSON.stringify(obj)); };
      try {
        if (req.headers.authorization !== `Bearer ${apiKey}`) throw fail(401, "UNAUTHORIZED", "Invalid API key");
        const path = (req.url || "").split("?")[0];
        for (const [method, re, handler] of routes) {
          const m = req.method === method && re.exec(path);
          if (m) return send(200, handler(raw ? JSON.parse(raw) : {}, req.headers, m));
        }
        throw fail(404, "NOT_FOUND", "No such route: " + req.method + " " + path);
      } catch (e) {
        send(e.status || 500, { data: { status: e.status || 500, code: e.code || "ERROR", message: e.message } });
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  api.url = `http://127.0.0.1:${server.address().port}`;
  api.apiKey = apiKey;
  api.close = () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  return api;
}
