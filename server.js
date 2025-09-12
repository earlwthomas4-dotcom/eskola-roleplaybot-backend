// server.js
// Secure backend for Eskola RolePlayBot (OpenAI proxy with sane CORS)

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ───────────────────────────────────────────────────────────────────────────────
// CORS: permissive in DEV for local HTML testing; strict in PROD for Squarespace
// ───────────────────────────────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === "production";

/**
 * Allowed web origins when deployed.
 * Adjust these to match your actual live domain(s) before launch.
 * - Keep Squarespace domains
 * - Replace the eskola.com entries with your real domain(s)
 */
const PROD_ALLOWED_ORIGINS = [
  "https://static1.squarespace.com",
  "https://*.squarespace.com",
  "https://*.squarespace-cdn.com",
  "https://eskola.com",          // ← replace if different
  "https://www.eskola.com"       // ← replace if different
];

/**
 * Extra dev origins so you can test locally via a simple server.
 * (Common local ports included; modify as needed.)
 */
const DEV_EXTRA_ORIGINS = [
  "null",                        // allows file:// (opening a local HTML file)
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];

/**
 * Build the final list based on environment.
 * In DEV: prod list + dev extras
 * In PROD: prod list only (NO "null", NO localhost)
 */
const ALLOWED_ORIGINS = isProd
  ? PROD_ALLOWED_ORIGINS
  : [...PROD_ALLOWED_ORIGINS, ...DEV_EXTRA_ORIGINS];

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow server-to-server and tools without Origin
      if (!origin) return cb(null, true);

      // Exact match or wildcard (*.domain.com)
      const ok = ALLOWED_ORIGINS.some((o) => {
        if (o === origin) return true;
        if (o.includes("*")) {
          const re = new RegExp("^" + o.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
          return re.test(origin);
        }
        return false;
      });

      return cb(ok ? null : new Error(`CORS blocked for origin: ${origin}`), ok);
    },
    credentials: false
  })
);

// Optional: friendly CORS error body (instead of default HTML)
app.use((err, req, res, next) => {
  if (err && /CORS blocked/.test(err.message)) {
    return res.status(403).json({ error: "CORS blocked", origin: req.headers.origin || null });
  }
  return next(err);
});

// ───────────────────────────────────────────────────────────────────────────────
// Health check
// ───────────────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true, env: isProd ? "production" : "development" }));

// ───────────────────────────────────────────────────────────────────────────────
// OpenAI proxy route
// ───────────────────────────────────────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.post("/chat", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY on the server." });
    }

    const { messages, scenario } = req.body || {};
    if (!Array.isArray(messages) || !scenario || !scenario.name || !scenario.company) {
      return res.status(400).json({
        error: "Invalid payload. Expected { messages: [], scenario: { name, company } }"
      });
    }

    // System prompt aligned to Eskola HELP methodology & GTM focus
    const systemPrompt = `
You are roleplaying as ${scenario.name} from ${scenario.company}.
Behave like a real commercial-roofing buyer. Sometimes receptive, sometimes resistant.
Respond to a salesperson using Eskola's H.E.L.P. framework:
- Hello: Did they introduce themselves, ask permission, and set a purpose?
- Educate: Did they ask good qualifying questions (asset profile, decision process, timelines, budget)?
- Leverage: Did they articulate Eskola value (safety, warranty, SHIELD maintenance, inspections, responsiveness, risk reduction)?
- Prove: Did they propose clear next steps (site walk, SHIELD inspection, proposal meeting)?
Keep replies concise, natural, and realistic. Offer objections periodically.
At the end of every reply, add a coaching line that starts with "Coach:" giving feedback on what they did well and what to try next using H.E.L.P.
    `.trim();

    const oaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",         // swap to "gpt-4" if you prefer
        temperature: 0.9,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages
        ]
      })
    });

    const data = await oaiRes.json();

    if (!oaiRes.ok) {
      // bubble up OpenAI error details for easier debugging
      return res.status(500).json({ error: "OpenAI API error", details: data });
    }

    return res.json(data);
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// Start server
// ───────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Eskola RolePlayBot backend running on port ${PORT} (${isProd ? "PROD" : "DEV"})`);
  console.log("Allowed origins:", ALLOWED_ORIGINS.join(", "));
});
