export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'Gemini not configured — add GEMINI_API_KEY to Vercel environment variables' });

  const { messages } = req.body;

  // Convert chat history to Gemini format
  // messages come in as [{role:'user',content:'...'}, {role:'assistant',content:'...'}]
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: 'You are Eqnoq in Deep Dive mode — a detailed, thorough AI assistant. Give comprehensive well-structured answers. Use markdown formatting with headers and bullet points where helpful. Never say you are Gemini or a Google product. You are Eqnoq.' }]
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
          }
        }),
      }
    );

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ error: data.error?.message || 'Gemini error' });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini';
    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
