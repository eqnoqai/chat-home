export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.GROQ_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'Not configured' });

  try {
    // req.body is base64 audio from client
    const { audio, mimeType = 'audio/webm' } = req.body;
    const audioBuffer = Buffer.from(audio, 'base64');

    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType });
    formData.append('file', blob, 'audio.webm');
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'json');

    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KEY}` },
      body: formData,
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Whisper error' });
    res.status(200).json({ text: data.text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
