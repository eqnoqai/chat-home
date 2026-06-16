export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const SERPER_KEY = process.env.SERPER_API_KEY;
  if (!GEMINI_KEY) return res.status(500).json({ error: 'Gemini not configured' });

  const { messages } = req.body;
  const lastMsg = messages[messages.length - 1];
  const query = typeof lastMsg.content === 'string'
    ? lastMsg.content
    : (lastMsg.content?.find?.(c => c.type === 'text')?.text || '');

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  let searchContext = '';

  // Search with Serper
  if (SERPER_KEY && query.trim()) {
    try {
      const r = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 6, gl: 'us', hl: 'en' })
      });
      const data = await r.json();
      const organic = data.organic?.slice(0, 5) || [];
      const answerBox = data.answerBox;
      const news = data.news?.slice?.(0, 3) || [];

      let ctx = `\n[TODAY IS ${today}. REAL-TIME SEARCH RESULTS:]\n`;
      if (answerBox?.answer) ctx += `Direct answer: ${answerBox.answer}\n`;
      if (answerBox?.snippet) ctx += `Featured: ${answerBox.snippet}\n`;
      if (news.length) news.forEach((n,i) => ctx += `News ${i+1}: ${n.title} — ${n.snippet}\n`);
      if (organic.length) organic.forEach((r,i) => ctx += `${i+1}. ${r.title}: ${r.snippet}\n`);
      ctx += '[END SEARCH]\n';
      if (organic.length || answerBox) searchContext = ctx;
    } catch(e) {}
  }

  // Convert messages to Gemini format
  const contents = messages
    .map(m => {
      let text = typeof m.content === 'string' ? m.content
        : (Array.isArray(m.content) ? (m.content.find(c => c.type === 'text')?.text || '') : '');
      return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text }] };
    })
    .filter(m => m.parts[0].text.trim());

  const sysPrompt = `You are Celestiq by Eqnoq — a deep, thorough AI. Give comprehensive, well-structured answers. Use markdown. Today is ${today}. Reply in the user's language. Never say you are Gemini or Google.${searchContext ? ' You have real-time search results — use them.' : ''}`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sysPrompt + searchContext }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
        })
      }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Gemini error' });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
    res.status(200).json({ text });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
