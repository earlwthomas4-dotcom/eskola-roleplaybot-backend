// server.js
// Eskola RolePlayBot backend (OpenAI proxy with solid CORS + helpful errors)

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ───────────────────────────────────────────────────────────────────────────────
// CORS
// - ALLOW_LOCAL_FILE=true lets you test with a local HTML file (Origin="null")
// - For launch, set ALLOW_LOCAL_FILE=false (or remove it) so only your live site works
// ───────────────────────────────────────────────────────────────────────────────
const ALLOW_LOCAL_FILE = (process.env.ALLOW_LOCAL_FILE || "true").toLowerCase() === "true";

const PROD_ALLOWED_ORIGINS = [
  "https://static1.squarespace.com",
  "https://*.squarespace.com",
  "https://*.squarespace-cdn.com",
  "https://eskola.com",       // update if your live domain differs
  "https://www.eskola.com"
];

const DEV_ALLOWED = ALLOW_LOCAL_FILE ? ["null", "http://localhost:3000", "http://127.0.0.1:5500", "http://localhost:5500"] : [];
const ALLOWED_ORIGINS = [...PROD_ALLOWED_ORIGINS, ...DEV_ALLOWED];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow server-to-server tools
    const ok = ALLOWED_ORIGINS.some(o => {
      if (o === origin) return true;
      if (o.includes("*")) {
        const re = new RegExp("^" + o.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
        return re.test(origin);
      }
      return false;
    });
    return cb(ok ? null : new Error(`CORS blocked for origin: ${origin}`), ok);
  }
}));

// Optional: cleaner CORS error body
app.use((err, req, res, next) => {
  if (err && /CORS blocked/.test(err.message)) {
    return res.status(403).json({ error: "CORS blocked", origin: req.headers.origin || null });
  }
  return next(err);
});

// ───────────────────────────────────────────────────────────────────────────────
// Health check
// ───────────────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    allowLocalFile: ALLOW_LOCAL_FILE,
    allowedOrigins: ALLOWED_ORIGINS
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// OpenAI proxy
// ───────────────────────────────────────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MODEL || "gpt-3.5-turbo"; // widely available; change if desired

app.post("/chat", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY on the server." });
    }
    const { messages, scenario } = req.body || {};
    if (!Array.isArray(messages) || !scenario?.name || !scenario?.company) {
      return res.status(400).json({
        error: "Invalid payload. Expected { messages: [], scenario: { name, company } }"
      });
    }

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
        model: MODEL,
        temperature: 0.9,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages
        ]
      })
    });

    const data = await oaiRes.json();
    if (!oaiRes.ok) {
      return res.status(500).json({ error: "OpenAI API error", details: data });
    }
    return res.json(data);
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Eskola RolePlayBot backend running on ${PORT}`);
  console.log("ALLOW_LOCAL_FILE:", ALLOW_LOCAL_FILE);
  console.log("ALLOWED_ORIGINS:", ALLOWED_ORIGINS.join(", "));
});
