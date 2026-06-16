export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const FAL_KEY = process.env.FAL_API_KEY;
  if (!FAL_KEY) return res.status(500).json({ error: 'FAL_API_KEY not configured. Get a free key at fal.ai — includes $10 free credit.' });

  const { prompt, width = 1024, height = 1024 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  try {
    // Submit to fal.ai queue
    const submit = await fetch('https://queue.fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${FAL_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        image_size: { width, height },
        num_inference_steps: 4,
        num_images: 1,
        enable_safety_checker: true
      })
    });

    if (!submit.ok) {
      const err = await submit.json().catch(() => ({}));
      return res.status(submit.status).json({ error: err.detail || err.message || 'Submit failed' });
    }

    const { request_id } = await submit.json();

    // Poll for result (max 60s)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const poll = await fetch(`https://queue.fal.run/fal-ai/flux/schnell/requests/${request_id}`, {
        headers: { 'Authorization': `Key ${FAL_KEY}` }
      });
      const status = await poll.json();
      if (status.status === 'COMPLETED' || status.images) {
        const images = status.images || status.output?.images || [];
        const url = images[0]?.url || images[0];
        if (url) return res.status(200).json({ url });
        return res.status(500).json({ error: 'No image in response' });
      }
      if (status.status === 'FAILED') {
        return res.status(500).json({ error: status.error || 'Generation failed' });
      }
    }
    return res.status(408).json({ error: 'Timed out. Try again.' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
