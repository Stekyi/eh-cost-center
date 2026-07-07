// Vercel serverless function: /api/embed
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { text } = req.body || {};
  const token = process.env.HUGGINGFACE_API_TOKEN;
  if (!token) return res.status(400).json({ error: 'No HuggingFace token set in env' });
  const model = 'sentence-transformers/all-MiniLM-L6-v2';
  const url = `https://api-inference.huggingface.co/pipeline/feature-extraction/${model}`;
  try {
    const hfRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: text }),
    });
    if (!hfRes.ok) {
      const err = await hfRes.text();
      return res.status(500).json({ error: err });
    }
    const data = await hfRes.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || e });
  }
};
