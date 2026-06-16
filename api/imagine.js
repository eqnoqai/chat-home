export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const FAL_KEY = process.env.FAL_API_KEY;
  if (!FAL_KEY) return res.status(500).json({ error: 'FAL_API_KEY not configured. Get a free key at fal.ai' });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt' });

  try {
    // Use synchronous endpoint — simpler, no polling needed
    const r = await fetch('https://fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${FAL_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        image_size: 'square_hd',
        num_inference_steps: 4,
        num_images: 1,
        enable_safety_checker: true
      })
    });

    const text = await r.text();
    if (!text) return res.status(500).json({ error: 'Empty response from fal.ai' });

    let data;
    try { data = JSON.parse(text); }
    catch(e) { return res.status(500).json({ error: 'Bad response from fal.ai: ' + text.slice(0, 100) }); }

    if (!r.ok) return res.status(r.status).json({ error: data.detail || data.message || 'fal.ai error' });

    const images = data.images || [];
    const url = images[0]?.url || images[0];
    if (!url) return res.status(500).json({ error: 'No image URL in response. Raw: ' + JSON.stringify(data).slice(0,200) });

    return res.status(200).json({ url });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
