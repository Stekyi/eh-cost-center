// Minimal Node.js proxy for HuggingFace embeddings
const express = require('express');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json());

app.post('/api/embed', async (req, res) => {
  const { text } = req.body;
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
    res.set('Access-Control-Allow-Origin', '*');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || e });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('Proxy running on http://localhost:' + PORT));
