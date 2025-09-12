// server.js
// Eskola RolePlayBot backend — scoped CORS + persona realism + receptivity dial

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ─────────── CORS (safe for prod, with optional local file testing) ───────────
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

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // server-to-server tools
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
  })
);

app.use((err, req, res, next) => {
  if (err && /CORS blocked/.test(err.message)) {
    return res.status(403).json({ error: "CORS blocked", origin: req.headers.origin || null });
  }
  return next(err);
});

// ───────────────── Health ─────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, allowLocalFile: ALLOW_LOCAL_FILE, allowedOrigins: ALLOWED_ORIGINS });
});

// ─────────── OpenAI proxy with persona + receptivity tuning ───────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MODEL || "gpt-3.5-turbo"; // compatible & cost-friendly

function receptivityTuning(persona, dial) {
  // dial: 0 Guarded, 1 Cool, 2 Neutral, 3 Warm
  const map = {
    cold_prospect: [
      "Ultra-guarded: 1 short sentence, do NOT ask questions proactively. Default to deflections. Only soften after the rep clearly does H (permission) + E (1 relevant qualifying question).",
      "Guarded: brief replies, rarely ask questions. Consider a short clarifying remark only if rep shows strong H+E.",
      "Balanced: brief but cooperative; can ask 1 short clarifying question; open to a tiny next step if value is clear.",
      "Open: conversational; may ask questions; receptive to small, low-friction next steps."
    ],
    qualified_lead: [
      "Guarded-analytical: terse, ask for proof only if rep earns it; keep pressure on clarity.",
      "Cool-analytical: selective questions; push on SLA/safety/warranty.",
      "Neutral-analytical: normal level of questions; compare options.",
      "Warm-analytical: collaborative; ready to advance with a clear next step."
    ],
    existing_customer: [
      "Guarded-practical: polite but brief; surface a light concern; avoid extra steps until value is explicit.",
      "Cool-practical: cooperative; willing to discuss timelines and simple next steps.",
      "Neutral-practical: friendly; open to SHIELD talk with risk/warranty framing.",
      "Warm-practical: positive; likely to agree to inspection/site walk."
    ]
  };
  const arr = map[persona] || map.cold_prospect;
  return arr[Math.max(0, Math.min(3, Number(dial) || 0))];
}

app.post("/chat", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY on the server." });

    const { messages, scenario, receptivity } = req.body || {};
    if (!Array.isArray(messages) || !scenario?.name || !scenario?.company || !scenario?.persona) {
      return res.status(400).json({
        error: "Invalid payload. Expected { messages: [], scenario: { name, company, persona }, receptivity }"
      });
    }

    const basePersona = {
      cold_prospect: `
- Keep it short (often 1 sentence). Guarded, busy, skeptical.
- Do NOT ask questions proactively unless the rep demonstrates BOTH: 
  (1) a clear permission-based opener (Hello) AND 
  (2) a crisp, relevant qualifying question (Educate).
- Default to deflections: “We’re covered,” “No budget,” “Not a priority,” “Send something.” 
- Only soften a little if H+E are clearly met; still avoid volunteering details.`,
      qualified_lead: `
- Engaged but discerning. Probe for proof (response times, safety/warranty, scope clarity, cost vs value).
- Compare vendors. Advance only if next steps are clear and business-relevant.`,
      existing_customer: `
- Friendly and practical; reference prior work/inspections.
- Raise one light concern (e.g., response time) but remain collaborative.
- Open to SHIELD upsell if framed as risk reduction and warranty health.`
    };

    const systemPrompt = `
You are roleplaying as ${scenario.name} from ${scenario.company}.
Persona:
${basePersona[scenario.persona] || basePersona.cold_prospect}

Receptivity tuning (dial=${receptivity}):
${receptivityTuning(scenario.persona, receptivity)}

Follow Eskola’s H.E.L.P. framework in your evaluation:
- Hello: permission & purpose
- Educate: smart qualification (asset profile, decision process, timelines, budget)
- Leverage: Eskola value (safety, warranty compliance, SHIELD biannual inspections & documentation, response time, lifecycle cost)
- Prove: propose or accept clear next steps (site walk, SHIELD inspection, brief scheduling call)

STYLE:
- Natural, realistic buyer language. Keep replies concise.
- Use objections appropriate to the persona. Avoid caricature.

FORMAT:
1) First, ONLY your customer reply (1–3 sentences; for cold prospects, often 1 sentence).
2) New line: "Coach: ..." — give 1–2 sentences of coaching: 
   - Did they follow H/E/L/P?
   - What is the single best next move (permission line, one qualifying question, a value angle, or a concrete next step)?
`.trim();

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
