export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.GROQ_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'Not configured' });

  const { text, voice = 'aura-asteria-en', lang = 'en' } = req.body;
  if (!text) return res.status(400).json({ error: 'No text' });

  const clean = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/[#*_~\[\]]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 800);

  if (!clean) return res.status(400).json({ error: 'No speakable text' });

  // Use PlayAI multilingual model for non-English
  const isEnglish = /^[a-zA-Z0-9\s.,!?'"\-:;()]+$/.test(clean.slice(0, 100));
  const model = isEnglish ? 'playai-tts' : 'playai-tts-arabic'; // fallback for non-Latin
  // For truly multilingual, use distil-whisper-large-v3-en won't work
  // Best approach: use playai-tts and let Groq handle it
  const selectedVoice = isEnglish ? voice : 'aura-asteria-en';

  try {
    const r = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
      body: JSON.stringify({
        model: 'playai-tts',
        input: clean,
        voice: voice,
        response_format: 'mp3'
      })
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(200).json({ fallback: true, error: err.error?.message });
    }

    const buf = await r.arrayBuffer();
    const b64 = Buffer.from(buf).toString('base64');
    res.status(200).json({ audio: b64, format: 'mp3' });
  } catch(e) {
    res.status(200).json({ fallback: true, error: e.message });
  }
}
