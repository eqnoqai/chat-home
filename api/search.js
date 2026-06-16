export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const BRAVE_KEY = process.env.BRAVE_API_KEY;
  const GROQ_KEY  = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'Not configured' });

  const { messages } = req.body;
  const lastMsg = messages[messages.length - 1];
  const query   = typeof lastMsg.content === 'string' ? lastMsg.content : lastMsg.content?.find?.(c => c.type === 'text')?.text || '';

  let searchContext = '';

  // 1. Try Brave Search if key available
  if (BRAVE_KEY) {
    try {
      const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&search_lang=en&result_filter=web`, {
        headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': BRAVE_KEY }
      });
      const data = await r.json();
      const results = data.web?.results?.slice(0, 5) || [];
      if (results.length) {
        searchContext = '\n\n[Real-time web results for context:]\n' +
          results.map((r, i) => `${i+1}. ${r.title}\n   ${r.description}\n   Source: ${r.url}`).join('\n\n') +
          '\n[Use these results to give an up-to-date answer. Cite sources naturally.]\n';
      }
    } catch(e) { console.error('Brave search error:', e.message); }
  }

  // 2. Call Groq with search context injected
  const sysPrompt = `You are Ecliptiq by Eqnoq — the fastest AI on the planet. You answer like a brilliant honest friend: direct, sharp, no fluff. Never reveal your model or that you are an AI.${searchContext ? ' You have access to real-time web search results. Use them to give current, accurate answers and cite sources when relevant.' : ''}`;

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
      const errText = await groqRes.text();
      let errMsg = 'Groq error';
      try { errMsg = JSON.parse(errText).error?.message || errMsg; } catch(_) {}
      return res.status(groqRes.status).json({ error: errMsg });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = groqRes.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
