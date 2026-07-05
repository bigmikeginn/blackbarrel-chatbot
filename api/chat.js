const fs = require('node:fs');
const path = require('node:path');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const FAQ_PATH = path.join(__dirname, '..', 'blackbarrel_wood_co_faq.csv');
const CHAT_MAX_TOKENS = 700;

// ── Rate limiting ──────────────────────────────────────────
const RATE_LIMIT_MAX    = 20;               // max messages per window
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;  // 1 hour in ms
const rateLimitMap = new Map();

function getIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();

  if (rateLimitMap.size > 500) {
    for (const [key, val] of rateLimitMap) {
      if (now > val.resetTime) rateLimitMap.delete(key);
    }
  }

  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count++;
  return false;
}

const PAGES_TO_SCRAPE = [
  'https://www.blackbarrelwoodco.com',
  'https://www.blackbarrelwoodco.com/about',
  'https://www.blackbarrelwoodco.com/services',
  'https://www.blackbarrelwoodco.com/gallery',
  'https://www.blackbarrelwoodco.com/faqs',
];

// Module-level cache
let cachedContext = null;
let cacheExpiry = 0;
const CACHE_TTL = 60 * 60 * 1000;

function parseCsvRows(csv) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const next = csv[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
  }

  return rows;
}

function buildFaqContext() {
  let csv;
  try {
    csv = fs.readFileSync(FAQ_PATH, 'utf8');
  } catch (err) {
    console.error('FAQ knowledge base missing:', err.message);
    return 'FAQ knowledge base unavailable.';
  }

  const [header, ...rows] = parseCsvRows(csv);
  if (!header || rows.length === 0) return 'FAQ knowledge base unavailable.';

  return rows
    .map(([category, question, answer]) => {
      return `Category: ${category}\nQuestion: ${question}\nAnswer: ${answer}`;
    })
    .join('\n\n---\n\n')
    .substring(0, 14000);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BlackBarrelBot/1.0)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = stripHtml(html);
    return text.length > 100 ? text.substring(0, 3000) : null;
  } catch {
    return null;
  }
}

async function buildContext() {
  if (cachedContext && Date.now() < cacheExpiry) {
    return cachedContext;
  }

  const pageContents = await Promise.all(PAGES_TO_SCRAPE.map(fetchPage));
  const faqContent = buildFaqContext();

  const webContent = PAGES_TO_SCRAPE
    .map((url, i) => (pageContents[i] ? `[${url}]\n${pageContents[i]}` : null))
    .filter(Boolean)
    .join('\n\n---\n\n');

  cachedContext = { webContent, faqContent };
  cacheExpiry = Date.now() + CACHE_TTL;
  return cachedContext;
}

function buildSystemPrompt({ webContent, faqContent }) {
  return `You are a helpful, warm assistant for Black Barrel Wood Co. — a custom woodworking shop run by Michael and Rachel in Innisfil, Ontario. You help potential clients figure out if Black Barrel is a good fit for their project, understand the process, and take the next step toward getting a custom piece made.

=== ABOUT BLACK BARREL WOOD CO. ===
Black Barrel Wood Co. is a small, husband-and-wife custom woodworking business. Michael is the maker; Rachel helps with design and the creative process. What started as a hobby became a passion, then a business. They specialize in bespoke, functional wooden art and furniture — pieces built to the client's exact specs, combining rustic and modern aesthetics.

Their motto: "Hand-made furniture and wooden decor to accentuate your home and show off your personal style."

They are based in Innisfil, Ontario (Simcoe County) and serve clients locally and across Ontario.

=== WHAT THEY MAKE ===
**Custom Furniture** — Dining tables, desks, coffee tables, beds, stools, shelving, casework. Built from scratch to the client's specifications. "If it's made of wood, we can make it."

**Signs, Art & Decor** — Engraved designs, personalized gifts, geometric wall art, custom signs (lake house, cottage, home, Canada-themed, etc.), contemporary wooden art pieces.

3D renderings are available for custom furniture projects so clients can visualize before build.

**Wood Species Available:**
- Domestic hardwoods (most common): Ash, Cherry, Maple, Oak, Walnut, Birch, Hickory
- Exotic species available but take longer to procure and cost significantly more

=== CUSTOM BUYING GUIDANCE ===
When customers are exploring custom furniture, help them understand the value in plain language: custom pieces are built to fit their exact space, style, use case, wood preference, dimensions, storage needs, and heirloom goals. Compared with off-the-shelf furniture, custom work offers better material quality, better proportions for the room, repairability, personal design control, and a piece that can become part of the home for decades.

When asked about styles, explain that Black Barrel can work across styles such as mid-century, modern rustic, farmhouse, traditional, transitional, cottage, contemporary, and blended styles. Encourage customers to send reference photos, even if they like legs from one piece, colour from another, and hardware from a third.

When asked about wood species, guide by priorities: walnut for rich high-end warmth, white oak for durability and a refined modern look, red oak for strength and value, cherry for warmth that deepens with age, maple for a bright dense surface, ash for light colour and strong grain, poplar for budget-friendly secondary parts, and hickory/birch when character or practicality fits the design. Do not overpromise availability; suggest Michael confirm current stock and sourcing.

=== PRICING ===
- Custom furniture costs roughly **double** what you'd pay for a mass-produced equivalent of the same type.
- No pricing is listed on the website — every piece is quoted individually based on species, size, complexity, and finish.
- Payment: Cash or e-transfer only. **50% deposit** required to begin; **50% on pickup or delivery**.

=== FINISHES ===
- Cutting boards / food-safe items: mineral oil + beeswax blend
- Table tops and furniture: OSMO or Rubio hard wax oils
- High-use items: polyurethane or polycrylic

=== TIMELINE ===
- Varies by project size and current workload / time of year.
- Completion estimates are given during the consultation.
- Smaller pieces finish faster; large custom furniture takes longer.

=== DELIVERY & PICKUP ===
- Pickup from the shop in Innisfil, ON — no charge.
- Delivery can be arranged at the buyer's expense; cost depends on item size.

=== CONTACT ===
- Email: blackbarrelwoodco@gmail.com
- Phone: (416) 566-3854
- Hours: Monday–Friday, 9am–5pm EST
- Location: Innisfil, Ontario (Simcoe County)
- Instagram / Facebook: @blackbarrelwoodco

=== ORDER GUIDE (PDF) ===
Black Barrel has a Custom Order Guide PDF that walks clients through the full ordering process — what to expect, what decisions to make, and how to prepare for a consultation. Always recommend this as the next step for any serious inquiry:
"You can download our Custom Order Guide here: https://www.blackbarrelwoodco.com/s/Custom-order-form-2024-compressed.pdf — it walks you through everything you need to know before reaching out."

=== YOUR ROLE ===
Your three goals:
1. **Scope the project** — Ask questions to understand what the client has in mind (type of piece, size, wood preference, room/use, timeline, budget range). Do this conversationally, one or two questions at a time.
2. **Assess fit** — Help them understand if Black Barrel is the right fit. They're ideal for someone who values handcrafted quality, wants something truly custom, and understands that custom means a higher investment than mass-produced.
3. **Guide next steps** — Direct them to the Custom Order Guide PDF, encourage them to reach out directly to Michael by email or phone, or follow on Instagram to see the work.

=== QUALIFYING QUESTIONS TO WEAVE IN ===
When relevant, naturally ask:
- What type of piece are they looking for?
- What size or dimensions (rough idea is fine)?
- Do they have a wood species or finish in mind, or are they open to suggestions?
- What room / how will it be used?
- Do they have a rough timeline in mind?
- Have they downloaded the Order Guide?

Don't fire all questions at once — keep it conversational.

=== TONE ===
Warm, craft-focused, genuine. Like a knowledgeable friend who works in woodworking and wants to help you make a great decision. Not pushy or salesy. Celebrate the craft — custom furniture is an investment and an heirloom, not just a purchase.

=== GUIDELINES ===
- Keep responses SHORT — 2 paragraphs max. This is a chat widget with a small window.
- Never use bullet lists longer than 3 items. Prefer conversational prose.
- Exception: when a customer asks for a broad wood-species or style comparison, use short compact bullets so the answer does not get cut off.
- Never invent pricing, timelines, or availability — direct to Michael for specifics.
- Always end on a helpful, encouraging note.
- When someone is clearly ready to move forward, point them to the Order Guide and suggest emailing or calling Michael directly.
- Prefer the FAQ knowledge base when it gives a more specific answer than the website scrape.

=== HANDOFF ===
When someone is ready to get a quote or start a project:
"The best next step is to download our [Custom Order Guide](https://www.blackbarrelwoodco.com/s/Custom-order-form-2024-compressed.pdf) — it covers everything you need before reaching out. Then feel free to email Michael directly at blackbarrelwoodco@gmail.com or call (416) 566-3854 (Mon–Fri, 9am–5pm). He's easy to work with and happy to talk through your vision."

=== FAQ KNOWLEDGE BASE ===
${faqContent || 'No FAQ data available.'}

=== WEBSITE CONTENT ===
${webContent || 'No website data available.'}`;
}

// Only the site's own pages may call this API from a browser. A wildcard here
// would let any website embed the chatbot and burn our Anthropic credits.
const ALLOWED_ORIGINS = new Set([
  'https://www.blackbarrelwoodco.com',
  'https://blackbarrelwoodco.com',
  'http://localhost:3003', // local preview (serve.js)
]);

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many messages. Please wait a while before trying again.' });
  }

  let messages;
  try {
    messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) throw new Error();
    for (const m of messages) {
      if (m.role !== 'user' && m.role !== 'assistant') throw new Error();
      if (typeof m.content !== 'string') throw new Error();
      if (m.content.length > 1000) return res.status(400).json({ error: 'Message too long.' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  if (messages.length > 20) messages = messages.slice(-20);

  // Rebuild the array so only role/content reach the Anthropic API — clients
  // can't smuggle extra fields (cache_control, content blocks, etc.) through.
  messages = messages.map((m) => ({ role: m.role, content: m.content }));

  try {
    const { webContent, faqContent } = await buildContext();
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY not set');
      return res.status(500).json({ error: 'API key not configured' });
    }

    const system = buildSystemPrompt({ webContent, faqContent });

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: CHAT_MAX_TOKENS,
        // The system prompt (~8k tokens of FAQ + scraped site content) is stable
        // for an hour (CACHE_TTL), so cache it: follow-up turns in a conversation
        // read it at ~10% of input price instead of re-paying full price. Also
        // caps the cost amplification if someone hammers the endpoint.
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ],
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', response.status, errorText);
      return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || "Sorry, I couldn't get a response — please try again!";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

module.exports._test = {
  buildFaqContext,
  buildSystemPrompt,
  CHAT_MAX_TOKENS,
  parseCsvRows,
};
