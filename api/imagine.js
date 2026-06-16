export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const PIXAZO_KEY = process.env.PIXAZO_API_KEY;
  if (!PIXAZO_KEY) {
    return res.status(500).json({ error: 'PIXAZO_API_KEY not set. Get a free key at pixazo.ai — includes 100 free calls.' });
  }

  const { prompt, width = 1024, height = 1024, steps = 4 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  const GENERATE_URL = 'https://gateway.pixazo.ai/flux-1-schnell/v1/flux-1-schnell-request';
  const STATUS_BASE  = 'https://gateway.pixazo.ai/v2/requests/status/';

  try {
    // Step 1: Submit generation request
    const submit = await fetch(GENERATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Ocp-Apim-Subscription-Key': PIXAZO_KEY
      },
      body: JSON.stringify({
        prompt,
        width,
        height,
        num_inference_steps: steps,
        output_format: 'jpeg',
        sync_mode: false
      })
    });

    if (!submit.ok) {
      const err = await submit.json().catch(() => ({}));
      return res.status(submit.status).json({
        error: err.message || err.title || `Pixazo error: ${submit.status}`
      });
    }

    const { request_id, polling_url } = await submit.json();
    const pollUrl = polling_url || `${STATUS_BASE}${request_id}`;

    // Step 2: Poll for result (max 90s)
    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 2000));

      const poll = await fetch(pollUrl, {
        headers: { 'Ocp-Apim-Subscription-Key': PIXAZO_KEY }
      });

      if (!poll.ok) continue;
      const status = await poll.json();

      // Check completed
      if (status.status === 'COMPLETED' || status.images || status.output) {
        const images = status.images || status.output?.images || status.output || [];
        const img = Array.isArray(images) ? images[0] : images;
        const url = img?.url || img?.image_url || (typeof img === 'string' ? img : null);
        if (url) return res.status(200).json({ url });
        return res.status(500).json({ error: 'No image URL in response', raw: JSON.stringify(status).slice(0, 300) });
      }

      if (status.status === 'FAILED' || status.status === 'ERROR') {
        return res.status(500).json({ error: status.error || status.message || 'Generation failed' });
      }
      // QUEUED or IN_PROGRESS — keep polling
    }

    return res.status(408).json({ error: 'Timed out after 90s. Try again.' });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
