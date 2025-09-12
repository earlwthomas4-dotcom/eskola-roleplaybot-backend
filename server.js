// server.js
// Eskola RolePlayBot backend — polished personas + H.E.L.P. coaching

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ───────────────────────────────────────────────────────────────────────────────
// CORS (kept sane, still lets you test file:// locally if ALLOW_LOCAL_FILE=true)
// ───────────────────────────────────────────────────────────────────────────────
const ALLOW_LOCAL_FILE = (process.env.ALLOW_LOCAL_FILE || "true").toLowerCase() === "true";

const PROD_ALLOWED_ORIGINS = [
  "https://static1.squarespace.com",
  "https://*.squarespace.com",
  "https://*.squarespace-cdn.com",
  "https://eskola.com",
  "https://www.eskola.com"
];

const DEV_ALLOWED = ALLOW_LOCAL_FILE
  ? ["null", "http://localhost:3000", "http://127.0.0.1:5500", "http://localhost:5500"]
  : [];

const ALLOWED_ORIGINS = [...PROD_ALLOWED_ORIGINS, ...DEV_ALLOWED];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const ok = ALLOWED_ORIGINS.some((o) => {
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

app.use((err, req, res, next) => {
  if (err && /CORS blocked/.test(err.message)) {
    return res.status(403).json({ error: "CORS blocked", origin: req.headers.origin || null });
  }
  return next(err);
}));

// Health
app.get("/health", (_req, res) => {
  res.json({ ok: true, allowLocalFile: ALLOW_LOCAL_FILE, allowedOrigins: ALLOWED_ORIGINS });
});

// OpenAI proxy
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MODEL || "gpt-3.5-turbo";

app.post("/chat", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY on the server." });

    const { messages, scenario } = req.body || {};
    if (!Array.isArray(messages) || !scenario?.name || !scenario?.company || !scenario?.persona) {
      return res.status(400).json({
        error: "Invalid payload. Expected { messages: [], scenario: { name, company, persona } }"
      });
    }

    // Persona-specific realism rules
    const personaDirectives = {
      cold_prospect: `
- Keep replies short (1–2 sentences). Be guarded, busy, and skeptical.
- Do NOT volunteer much detail. Avoid asking the rep questions unless they earn it.
- Typical deflections: "We’re covered," "No budget," "Send something over," "Not a priority."
- Only soften if the rep uses a clear permission-based opener (H) and asks crisp, relevant questions (E).`,
      qualified_lead: `
- Engaged but discerning. Compare vendors and probe for proof.
- Ask about response times, safety/warranty, scope clarity, and value.
- Will advance if the rep articulates a clear next step (P) with business impact.`,
      existing_customer: `
- Friendly and practical. Reference prior work orders/inspections.
- Surface a light concern (e.g., response time), but remain collaborative.
- Open to cross-sell of SHIELD maintenance if framed around risk reduction and warranty health.`
    };

    const systemPrompt = `
You are roleplaying as ${scenario.name} from ${scenario.company}.
Persona rules:
${personaDirectives[scenario.persona] || ""}

Ground your behavior and feedback in Eskola’s approach:
- Use the H.E.L.P. framework: Hello (permission/setup) → Educate (qualify with questions) → Leverage (show value) → Prove (advance next steps). 
- Respect professional communication standards: clarity, appropriate tone, concise, no jargon unless the rep has signaled familiarity.
- Align to Eskola GTM: target verticals like manufacturing/industrial, education, healthcare, commercial real estate; solutions like roofing, inspections, service, waterproofing, and SHIELD preventative maintenance.
- Use realistic buyer language and objections. Avoid being a caricature.

Response format:
1) First write ONLY your natural reply as the customer (1–3 sentences; for cold prospects, 1–2 max).
2) On a new line, add: "Coach: ..." 
   - Briefly evaluate how well the rep followed H.E.L.P. 
   - Suggest the single best next move (a permission line, one crisp qualifying question, one value angle, or one concrete next step). Keep coaching to 1–2 sentences.

Notes to yourself:
- Reward permission-based intros and active listening (paraphrasing, clarifying).
- For "Leverage", tie value to safety, warranty compliance, response-time, lifecycle cost, and SHIELD’s biannual inspections & documentation.
- For "Prove", accept a small next step when appropriate (site walk, SHIELD inspection, brief scheduling call).`.trim();

    const oaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.85,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages
        ]
      })
    });

    const data = await oaiRes.json();
    if (!oaiRes.ok) return res.status(500).json({ error: "OpenAI API error", details: data });
    return res.json(data);
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Eskola RolePlayBot backend running on port ${PORT}`);
  console.log("ALLOW_LOCAL_FILE:", ALLOW_LOCAL_FILE);
  console.log("ALLOWED_ORIGINS:", ALLOWED_ORIGINS.join(", "));
});
