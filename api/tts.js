export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.GROQ_API_KEY;
  if (!KEY) return res.status(200).json({ fallback: true, error: 'No key' });

  const { text, voice = 'Celeste-PlayAI' } = req.body;
  if (!text) return res.status(200).json({ fallback: true, error: 'No text' });

  const clean = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/[#*_~\[\]]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 500);

  if (!clean) return res.status(200).json({ fallback: true });

  // Try PlayAI TTS on Groq
  const models = ['playai-tts', 'playai-tts-arabic'];
  // Female voices: Celeste-PlayAI, Aaliyah-PlayAI, Adelaide-PlayAI
  // Male voices: Atlas-PlayAI, Angelo-PlayAI, Arsenio-PlayAI

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
      console.error('TTS error:', err);
      return res.status(200).json({ fallback: true, error: err.error?.message || 'TTS failed' });
    }

    const buf = await r.arrayBuffer();
    const b64 = Buffer.from(buf).toString('base64');
    return res.status(200).json({ audio: b64, format: 'mp3' });

  } catch(e) {
    return res.status(200).json({ fallback: true, error: e.message });
  }
}
