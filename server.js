import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());

// 🔒 Allow your Squarespace site to call this server.
// Replace with your real domain when you know it, e.g. https://www.eskolaroofing.com
const allowedOrigins = [
  "https://www.squarespace.com", // Squarespace editor preview
  "https://*.squarespace.com",    // some templates render from a subdomain
  "https://your-site-domain.com"  // <- replace with your real site domain later
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow server-to-server / curl
    const ok = allowedOrigins.some(o => {
      if (o.includes("*")) {
        const regex = new RegExp("^" + o.replace(/\./g,"\\.").replace("*",".*") + "$");
        return regex.test(origin);
      }
      return origin === o;
    });
    cb(ok ? null : new Error("CORS blocked"), ok);
  }
}));

app.get("/health", (_, res) => res.json({ ok: true }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.post("/chat", async (req, res) => {
  try {
    const { messages, scenario } = req.body;

    // System prompt = persona + Eskola HELP framework
    const systemPrompt = `
You are roleplaying as ${scenario.name} from ${scenario.company}.
Behave like a real buyer in commercial roofing. Sometimes receptive, sometimes resistant.
Evaluate the salesperson using Eskola's H.E.L.P. process:
- Hello: Did they introduce themselves, ask permission, and establish purpose?
- Educate: Did they ask good qualifying questions to discover needs, asset profile, decision process?
- Leverage: Did they articulate value (safety, warranty, risk reduction, SHIELD maintenance, inspections, service responsiveness)?
- Prove: Did they propose clear next steps (site walk, SHIELD inspection, proposal meeting)?
Keep replies concise and realistic. Offer objections now and then.
At the end of each reply, add a coaching line that starts with "Coach:" telling them what they did well and what to try next per H.E.L.P.
    `;

    const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // fast & cost-efficient; you can switch to gpt-4 if you want
        temperature: 0.9,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages
        ]
      })
    });

    const data = await apiRes.json();
    if (apiRes.status >= 400) {
      console.error("OpenAI error:", data);
      return res.status(500).json({ error: "OpenAI API error", details: data });
    }
    return res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Eskola RolePlayBot backend running on ${PORT}`));
