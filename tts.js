export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.GROQ_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'Not configured' });

  const { text, voice = 'aura-asteria-en' } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  // Clean text — remove markdown, URLs, limit length
  const clean = text
    .replace(/```[\s\S]*?```/g, 'code block')
    .replace(/`[^`]+`/g, '')
    .replace(/[#*_~\[\]]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 800); // Groq TTS limit

  if (!clean) return res.status(400).json({ error: 'No speakable text' });

  try {
    const r = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KEY}`
      },
      body: JSON.stringify({
        model: 'playai-tts',
        input: clean,
        voice: voice,
        response_format: 'mp3'
      })
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      // Fallback gracefully — return empty so browser TTS kicks in
      return res.status(200).json({ fallback: true, error: err.error?.message || 'TTS error' });
    }

    const audioBuffer = await r.arrayBuffer();
    const b64 = Buffer.from(audioBuffer).toString('base64');
    res.status(200).json({ audio: b64, format: 'mp3' });

  } catch(e) {
    res.status(200).json({ fallback: true, error: e.message });
  }
}
