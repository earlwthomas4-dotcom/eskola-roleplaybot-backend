// server.js
// Eskola RolePlayBot backend — persona realism + receptivity + anti-repeat
// (FIX: filter out non-OpenAI roles like "coach" before calling OpenAI)

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ─────────── CORS ───────────
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
  })
);

app.use((err, req, res, next) => {
  if (err && /CORS blocked/.test(err.message)) {
    return res.status(403).json({ error: "CORS blocked", origin: req.headers.origin || null });
  }
  return next(err);
});

// ─────────── Health ───────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, allowLocalFile: ALLOW_LOCAL_FILE, allowedOrigins: ALLOWED_ORIGINS });
});

// ─────────── OpenAI proxy ───────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MODEL || "gpt-3.5-turbo";

// Use only roles OpenAI supports
const OPENAI_ROLES = new Set(["system", "assistant", "user"]);

// Pull last assistant lines to discourage repeats
function antiRepeatList(messages, maxChars = 1200) {
  const last = [...messages].reverse().filter(m => m.role === "assistant").slice(0, 6);
  let text = last.map(m => m.content).join(" • ");
  if (text.length > maxChars) text = text.slice(-maxChars);
  return text || "(none)";
}

function receptivityTuning(persona, dial) {
  const d = Math.max(0, Math.min(3, Number(dial) || 0));
  const map = {
    cold_prospect: [
      "Ultra-guarded: 1 short sentence, no proactive questions; defaults to deflections; only softens after clear H (permission) + E (relevant qualifying question).",
      "Guarded: brief replies; rarely asks questions; may offer a tiny clarifier if rep shows strong H+E.",
      "Balanced: still brief but cooperative; can ask one short clarifier; open to a very small next step if value is explicit.",
      "Open: conversational; may ask a few questions; receptive to a low-friction next step."
    ],
    qualified_lead: [
      "Guarded-analytical: terse; asks for proof only if rep earns it; pushes for clarity.",
      "Cool-analytical: selective questions; pressure on SLA/safety/warranty.",
      "Neutral-analytical: normal questions; compares options fairly.",
      "Warm-analytical: collaborative; ready to advance with a clear next step."
    ],
    existing_customer: [
      "Guarded-practical: polite but brief; raises a small concern; avoids extra steps until value is explicit.",
      "Cool-practical: cooperative; open to schedule talk and simple next steps.",
      "Neutral-practical: friendly; receptive to SHIELD framed as risk/warranty protection.",
      "Warm-practical: positive; likely to accept inspection/site walk."
    ]
  };
  const list = map[persona] || map.cold_prospect;
  return list[d];
}

app.post("/chat", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY on the server." });

    const { messages, scenario, receptivity, style } = req.body || {};
    if (!Array.isArray(messages) || !scenario?.name || !scenario?.company || !scenario?.persona) {
      return res.status(400).json({
        error: "Invalid payload. Expected { messages: [], scenario: { name, company, persona }, receptivity, style }"
      });
    }

    // Filter out any non-OpenAI roles (e.g., 'coach')
    const sanitizedMessages = messages
      .filter(m => OPENAI_ROLES.has(m.role))
      .map(m => ({ role: m.role, content: m.content }));

    const diversityBlock = antiRepeatList(sanitizedMessages);

    const quirk = (style?.quirk || "curt and to the point").toString();
    const seed = (style?.seed || "session").toString();
    const drift = Math.max(0, Math.min(0.35, Number(style?.drift || 0)));

    const basePersona = {
      cold_prospect: `
- Keep it short (often 1 sentence). Guarded, busy, skeptical.
- Do NOT ask questions proactively unless BOTH are true:
  (1) the rep uses a clear permission-based opener (Hello), and
  (2) the rep asks one crisp, relevant qualifying question (Educate).
- Default to deflections: “We’re covered,” “No budget,” “Not a priority,” “Send something.”
- Only soften after clear H+E; still avoid volunteering details.`,
      qualified_lead: `
- Engaged but discerning. Probe for proof (response times, safety/warranty, scope clarity, cost vs value).
- Compare vendors. Advance only if next steps are clear and business-relevant.`,
      existing_customer: `
- Friendly and practical; reference prior work/inspections.
- Raise one light concern (e.g., response time) but remain collaborative.
- Open to SHIELD upsell when framed as risk reduction and warranty health.`
    };

    const systemPrompt = `
You are roleplaying as ${scenario.name} from ${scenario.company}.
Persona rules:
${basePersona[scenario.persona] || basePersona.cold_prospect}

Receptivity tuning (0..3 = guarded→warm; current=${receptivity}):
${receptivityTuning(scenario.persona, receptivity)}

Session flavor (keep subtle & consistent):
- Seed: ${seed}
- Quirk: ${quirk}
- Topic drift budget: up to ${(drift * 100).toFixed(0)}% of turns may include a tiny aside if rapport allows; remain professional.

Diversity & realism:
- Vary sentence length, tone, and cadence. Use natural contractions and hedges.
- Never reuse exact phrasings from your prior turns in this chat. Avoid verbatim from: ${diversityBlock}
- Don’t sound templated. If you refuse or deflect, vary how you do it.

Eskola alignment:
- Evaluate the rep with H.E.L.P.: Hello (permission), Educate (smart qualification—asset profile, decision process, timelines, budget), Leverage (value: safety, warranty compliance, SHIELD biannual inspections & documentation, response time, lifecycle cost), Prove (clear next step: site walk, SHIELD inspection, brief scheduling call).
- Tie “Leverage” to business impact. Accept small next steps when appropriate.

FORMAT:
1) First, ONLY your customer reply (1–3 sentences; for cold prospects, usually 1 sentence).
2) New line: "Coach: ..." — 1–2 sentences:
   • Did they follow H/E/L/P?
   • What single next move should they try (permission line, one qualifying question, a value angle, or a concrete next step)?
`.trim();

    const oaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.98,
        top_p: 0.9,
        presence_penalty: 0.9,
        frequency_penalty: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          ...sanitizedMessages
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
