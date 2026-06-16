export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const SERPER_KEY = process.env.SERPER_API_KEY;
  const GROQ_KEY   = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'Not configured' });

  const { messages } = req.body;
  const lastMsg = messages[messages.length - 1];
  const query = typeof lastMsg.content === 'string'
    ? lastMsg.content
    : (lastMsg.content?.find?.(c => c.type === 'text')?.text || '');

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  // Only search for genuinely real-time queries
  const needsSearch = SERPER_KEY && /\b(today|tonight|right now|currently|live|score|match|game|weather|news|latest|breaking|price|stock|crypto|bitcoin|who won|what happened|update|release|just|this week|this month|2024|2025|2026)\b/i.test(query);

  let searchContext = '';

  if (needsSearch) {
    try {
      const r = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 5, gl: 'us', hl: 'en' })
      });
      const data = await r.json();
      const organic = data.organic?.slice(0, 4) || [];
      const answerBox = data.answerBox;
      const news = data.news?.slice?.(0, 3) || [];

      let ctx = `\n[Today is ${today}. Real-time search results:]\n`;
      if (answerBox?.answer) ctx += `Answer: ${answerBox.answer}\n`;
      else if (answerBox?.snippet) ctx += `${answerBox.snippet}\n`;
      if (news.length) news.forEach(n => ctx += `- ${n.title}: ${n.snippet}\n`);
      if (organic.length) organic.forEach(r => ctx += `- ${r.title}: ${r.snippet}\n`);
      ctx += '[End of search results]\n';
      if (organic.length || answerBox) searchContext = ctx;
    } catch(e) {}
  }

  const SYS = `You are Ecliptiq by Eqnoq — a sharp, direct AI that answers like a knowledgeable friend. Rules:
- Answer in 1-4 sentences for simple questions. Use numbered points only when listing multiple items.
- No emojis. No filler phrases like "Great question" or "Certainly".
- No unnecessary links or social media references. Only cite a source if it's directly relevant.
- Reply in the same language the user writes in.
- Today is ${today}.
${searchContext ? '- You have real-time search data below. Use it when relevant.' : '- You have knowledge up to early 2025. Be honest if something may have changed.'}`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1024,
        temperature: 0.65,
        stream: true,
        messages: [
          { role: 'system', content: SYS + searchContext },
          ...messages
        ]
      })
    });

    if (!groqRes.ok) {
      const t = await groqRes.text();
      let msg = 'API error';
      try { msg = JSON.parse(t).error?.message || msg; } catch(_) {}
      return res.status(groqRes.status).json({ error: msg });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = groqRes.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(dec.decode(value, { stream: true }));
    }
    res.end();
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
