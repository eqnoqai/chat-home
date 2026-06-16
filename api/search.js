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
  const query   = typeof lastMsg.content === 'string'
    ? lastMsg.content
    : lastMsg.content?.find?.(c => c.type === 'text')?.text || '';

  let searchContext = '';

  // 1. Serper search if key available
  if (SERPER_KEY && query) {
    try {
      const r = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 5, gl: 'us', hl: 'en' })
      });
      const data = await r.json();

      const organic = data.organic?.slice(0, 5) || [];
      const answerBox = data.answerBox;
      const knowledgeGraph = data.knowledgeGraph;

      let ctx = '\n\n[Real-time web search results:]\n';

      // Answer box — most direct answer
      if (answerBox?.answer) ctx += `Direct answer: ${answerBox.answer}\n\n`;
      else if (answerBox?.snippet) ctx += `Featured snippet: ${answerBox.snippet}\n\n`;

      // Knowledge graph
      if (knowledgeGraph?.description) ctx += `Knowledge: ${knowledgeGraph.description}\n\n`;

      // Organic results
      if (organic.length) {
        ctx += organic.map((r, i) =>
          `${i+1}. ${r.title}\n   ${r.snippet}\n   ${r.link}`
        ).join('\n\n');
      }

      ctx += '\n[End of search results. Use these to give a current, accurate answer. Cite sources naturally when helpful.]\n';
      if (organic.length || answerBox) searchContext = ctx;

    } catch(e) { console.error('Serper error:', e.message); }
  }

  // 2. Call Groq with search context
  const sysPrompt = `You are Ecliptiq by Eqnoq — the fastest AI on the planet. You answer like a brilliant honest friend: direct, sharp, no fluff. Never reveal your model or that you are an AI.${searchContext ? ' You have real-time web search results. Use them to give current accurate answers. Cite sources when relevant.' : ''}`;

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
      let msg = 'Groq error';
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
