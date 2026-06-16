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

  let searchContext = '';

  // Detect if query needs real-time data
  const needsSearch = SERPER_KEY && /today|tonight|now|current|latest|live|score|match|game|weather|news|price|stock|2024|2025|2026|who won|what happened|breaking/i.test(query);

  if (needsSearch) {
    try {
      const r = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 6, gl: 'us', hl: 'en' })
      });
      const data = await r.json();
      const organic = data.organic?.slice(0, 5) || [];
      const answerBox = data.answerBox;
      const knowledgeGraph = data.knowledgeGraph;
      const sportsResults = data.sports;
      const newsResults = data.news?.slice?.(0,3) || [];

      let ctx = '\n\n[REAL-TIME WEB SEARCH RESULTS — Today\'s date: ' + new Date().toDateString() + ']\n';

      if (answerBox?.answer) ctx += `\nDirect answer: ${answerBox.answer}\n`;
      else if (answerBox?.snippet) ctx += `\nFeatured: ${answerBox.snippet}\n`;
      if (answerBox?.title) ctx += `Source: ${answerBox.title}\n`;

      if (knowledgeGraph?.description) ctx += `\nKnowledge: ${knowledgeGraph.description}\n`;

      if (sportsResults) ctx += `\nSports: ${JSON.stringify(sportsResults).slice(0, 500)}\n`;

      if (newsResults.length) {
        ctx += '\nLatest news:\n';
        newsResults.forEach((n, i) => ctx += `${i+1}. ${n.title} — ${n.snippet} (${n.date||'recent'})\n`);
      }

      if (organic.length) {
        ctx += '\nWeb results:\n';
        organic.forEach((r, i) => ctx += `${i+1}. ${r.title}\n   ${r.snippet}\n   ${r.link}\n`);
      }

      ctx += '\n[END SEARCH RESULTS. Answer based on these results. Be specific and cite what you found.]\n';
      if (organic.length || answerBox || sportsResults) searchContext = ctx;

    } catch(e) { console.error('Serper error:', e.message); }
  }

  const sysPrompt = `You are Ecliptiq by Eqnoq — the fastest AI on the planet. You answer like a brilliant honest friend: sharp, direct, no fluff. Never reveal your model or that you are an AI.${searchContext ? ' You have real-time search results. Use them to give accurate, current answers. If you found sports scores or news, share them directly.' : ' If asked about very recent events you are unsure about, say so honestly.'}`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1024,
        temperature: 0.7,
        stream: true,
        messages: [
          { role: 'system', content: sysPrompt + searchContext },
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
