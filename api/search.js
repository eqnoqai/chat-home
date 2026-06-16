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
  let searchContext = '';

  // Always search if Serper key exists — real-time grounding for everything
  if (SERPER_KEY && query.trim()) {
    try {
      const r = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 6, gl: 'us', hl: 'en', tbs: 'qdr:d' }) // tbs=qdr:d = past 24 hours
      });
      const data = await r.json();

      const organic    = data.organic?.slice(0, 5) || [];
      const answerBox  = data.answerBox;
      const knowledgeGraph = data.knowledgeGraph;
      const news       = data.news?.slice?.(0, 4) || [];
      const sports     = data.sports;

      let ctx = `\n\n[TODAY IS ${today}. REAL-TIME WEB SEARCH RESULTS:]\n`;

      if (answerBox?.answer)   ctx += `\nDirect answer: ${answerBox.answer}\n`;
      if (answerBox?.snippet)  ctx += `Featured: ${answerBox.snippet}\n`;
      if (answerBox?.title)    ctx += `Source: ${answerBox.title}\n`;
      if (knowledgeGraph?.description) ctx += `\n${knowledgeGraph.description}\n`;

      if (sports) {
        ctx += `\nSports results:\n${JSON.stringify(sports).slice(0, 800)}\n`;
      }

      if (news.length) {
        ctx += `\nLatest news:\n`;
        news.forEach((n,i) => ctx += `${i+1}. ${n.title} — ${n.snippet} (${n.date||'recent'}) ${n.link}\n`);
      }

      if (organic.length) {
        ctx += `\nWeb results:\n`;
        organic.forEach((r,i) => ctx += `${i+1}. ${r.title}\n   ${r.snippet}\n   ${r.link}\n`);
      }

      ctx += `\n[END SEARCH. Use these results to give a current, accurate answer. Today is ${today}. Cite sources when helpful.]\n`;

      if (organic.length || answerBox || sports || news.length) {
        searchContext = ctx;
      }
    } catch(e) {
      console.error('Serper error:', e.message);
    }
  }

  // If no Serper key, tell user directly
  const noKeyNote = !SERPER_KEY
    ? `\n[Note: Real-time search is not configured. If asked about live events, scores, or breaking news, be honest that you may not have the latest info and suggest checking a live source.]\n`
    : '';

  const SYS = `You are Ecliptiq by Eqnoq — the fastest AI on the planet. You answer like a brilliant honest friend: direct, sharp, no fluff. Never reveal your model or that you are an AI. Today's date is ${today}. IMPORTANT: Always reply in the same language the user writes in.${searchContext ? ' You have real-time web search results — use them to give accurate, current answers. If you found scores or news, share them directly and confidently.' : noKeyNote}`;

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
