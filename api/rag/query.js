// Full RAG handler for Vercel/local dev
// - Verifies Firebase ID token and admin claim (if provided)
// - Rate-limits per-user
// - Computes embedding via Hugging Face (if token present)
// - Finds top-K similar documents from `rag_embeddings` (Firestore)
// - Calls Fireworks first (if key present), falls back to Hugging Face generation
// - Redacts simple PII (emails/phones) from responses

const admin = require('firebase-admin')

let adminApp = null
let initError = null

function initAdmin() {
  if (adminApp) return adminApp
  if (admin.apps && admin.apps.length) {
    adminApp = admin.app()
    return adminApp
  }
  
  const key = process.env.FIREBASE_SA_KEY
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID || 'eh-cost-center'
  
  if (!key) {
    const error = new Error('FIREBASE_SA_KEY not found in environment variables')
    console.error(error.message)
    initError = error
    throw error
  }
  
  console.log('FIREBASE_SA_KEY exists, length:', key.length)
  
  let obj = null
  
  // Try parsing as raw JSON first
  try { 
    obj = JSON.parse(key)
    console.log('Parsed FIREBASE_SA_KEY as raw JSON')
  } catch (e) {
    console.log('Not raw JSON, trying base64 decode...')
    // Try base64 decode
    try {
      const decoded = Buffer.from(key, 'base64').toString('utf8')
      console.log('Base64 decoded, length:', decoded.length)
      obj = JSON.parse(decoded)
      console.log('Successfully parsed base64 decoded JSON')
    } catch (e2) {
      const error = new Error('Failed to parse FIREBASE_SA_KEY: ' + e2.message)
      console.error(error.message)
      initError = error
      throw error
    }
  }
  
  if (!obj || !obj.private_key || !obj.client_email) {
    const error = new Error('Invalid service account key format - missing required fields')
    console.error(error.message)
    initError = error
    throw error
  }
  
  console.log('Initializing Firebase Admin for project:', obj.project_id)
  console.log('Using client email:', obj.client_email)
  
  try {
    adminApp = admin.initializeApp({ 
      credential: admin.credential.cert(obj),
      projectId: obj.project_id || projectId
    })
    console.log('Firebase Admin initialized successfully')
    return adminApp
  } catch (e) {
    const error = new Error('Failed to initialize Firebase Admin: ' + e.message)
    console.error(error.message)
    initError = error
    throw error
  }
}

// Try to initialize on module load
try {
  initAdmin()
} catch (e) {
  console.error('Initial Firebase Admin initialization failed:', e.message)
}

// Lazy-load Firestore when needed
let db = null
function getDb() {
  if (!db) {
    if (!adminApp) initAdmin()
    db = admin.firestore()
  }
  return db
}

const HF_MODEL = 'sentence-transformers/all-MiniLM-L6-v2'
const GEN_MODEL = 'zai-org/GLM-4.6'

function redactPII(text) {
  if (!text) return text
  // simple email/phone redaction
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/\+?\d[\d ()-]{6,}\d/g, '[REDACTED_PHONE]')
}

function cosine(a,b){
  if(!a||!b||a.length!==b.length) return -1
  let dot=0,na=0,nb=0
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i]}
  return dot/Math.sqrt(na*nb + 1e-12)
}

async function hfEmbedding(text){
  const token = process.env.HUGGINGFACE_API_TOKEN
  if(!token) return null
  const res = await fetch('https://api-inference.huggingface.co/embeddings',{
    method:'POST', headers:{ 'Authorization': `Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ model: HF_MODEL, inputs: text })
  })
  if(!res.ok) return null
  const data = await res.json()
  // some HF embedding returns {embedding: [...] } or [ ... ]
  if(Array.isArray(data)) return data[0].embedding || data[0]
  if(data.embedding) return data.embedding
  return null
}

async function callFireworks(prompt){
  const key = process.env.FIREWORKS_API_KEY
  if(!key) {
    console.log('No Fireworks API key')
    throw new Error('no_fireworks')
  }
  console.log('Calling Fireworks API...')
  try{
    const res = await fetch('https://api.fireworks.ai/inference/v1/chat/completions',{
      method:'POST', 
      headers:{ 
        'Authorization': `Bearer ${key}`, 
        'Content-Type':'application/json' 
      },
      body: JSON.stringify({ 
        model: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 256 
      })
    })
    console.log('Fireworks response status:', res.status)
    if(!res.ok) {
      const errorText = await res.text()
      console.error('Fireworks error response:', errorText)
      throw new Error('fireworks_failed: ' + errorText.substring(0, 100))
    }
    const j = await res.json()
    console.log('Fireworks response:', JSON.stringify(j).substring(0, 200))
    return j.choices?.[0]?.message?.content || j.output || j.text || null
  }catch(e){ 
    console.error('Fireworks error:', e.message)
    throw e 
  }
}

async function callHFGen(prompt){
  const token = process.env.HUGGINGFACE_API_TOKEN
  if(!token) {
    console.log('No HuggingFace API token')
    throw new Error('no_hf')
  }
  console.log('Calling HuggingFace API...')
  const url = `https://api-inference.huggingface.co/models/${GEN_MODEL}`
  const res = await fetch(url, { 
    method:'POST', 
    headers: { 
      Authorization: `Bearer ${token}`, 
      'Content-Type':'application/json' 
    }, 
    body: JSON.stringify({ 
      inputs: prompt, 
      parameters: { max_new_tokens: 256 } 
    }) 
  })
  console.log('HuggingFace response status:', res.status)
  if(!res.ok) {
    const errorText = await res.text()
    console.error('HuggingFace error response:', errorText)
    throw new Error('hf_gen_failed: ' + errorText.substring(0, 100))
  }
  const j = await res.json()
  console.log('HuggingFace response:', JSON.stringify(j).substring(0, 200))
  // HF returns [{generated_text: '...'}] or {error:...}
  if(Array.isArray(j) && j[0] && j[0].generated_text) return j[0].generated_text
  if(j.generated_text) return j.generated_text
  if(typeof j === 'string') return j
  return JSON.stringify(j)
}

module.exports = async (req, res) => {
  try{
    // Check if Firebase Admin initialized successfully
    if (initError) {
      console.error('Firebase Admin init error:', initError.message)
      return res.status(500).json({ 
        error: 'firebase_init_failed', 
        details: initError.message 
      })
    }
    
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const body = req.body || {}
    const q = (body.query || body.q || '').toString().trim()
    const topK = Number(body.topK || 5)
    if(!q) return res.status(400).json({ error: 'missing_query' })

    // Auth: optional but required for provider access
    let uid = 'anonymous'
    const authHeader = req.headers.authorization || req.headers.Authorization
    if(authHeader && authHeader.startsWith('Bearer ')){
      const token = authHeader.split(' ')[1]
      try{
        console.log('Verifying Firebase ID token...')
        const decoded = await admin.auth().verifyIdToken(token)
        console.log('Token verified for user:', decoded.uid, 'admin:', decoded.admin)
        uid = decoded.uid || 'anon'
        // enforce admin claim
        if(!(decoded.admin || decoded.role === 'admin' || decoded.admin === true)){
          console.log('User is not admin')
          return res.status(403).json({ error: 'requires_admin' })
        }
      }catch(e){
        console.error('Token verify failed:', e.message, e.code)
        return res.status(401).json({ error: 'invalid_token', details: e.message })
      }
    } else {
      // No token: allow for local testing but restrict provider usage
      uid = req.ip || 'anon'
      if(!process.env.RAG_ALLOW_ANON){
        // respond with placeholder if providers are not allowed for anon
        const hf = process.env.HUGGINGFACE_API_TOKEN
        const fw = process.env.FIREWORKS_API_KEY
        if(!hf && !fw) return res.json({ answer: 'Local RAG not configured. Provide provider keys or authenticate.', sources: [], note: 'no_auth' })
      }
    }

    // rate limit per uid (60 per hour)
    const db = getDb()
    const rlRef = db.collection('rag_rate_limits').doc(uid)
    await db.runTransaction(async tx => {
      const snap = await tx.get(rlRef)
      const now = Date.now()
      const H = 60*60*1000
      if(!snap.exists){ tx.set(rlRef, { count: 1, resetAt: now + H }) }
      else{
        const data = snap.data() || {}
        if(now > (data.resetAt || 0)) tx.set(rlRef, { count: 1, resetAt: now + H })
        else if((data.count || 0) >= 60) throw new Error('rate_limited')
        else tx.update(rlRef, { count: (data.count || 0) + 1 })
      }
    }).catch(e=>{ if(e.message === 'rate_limited') throw { status:429, message:'rate_limited' }; else throw e })

    // build embedding if HF token exists
    let qEmbedding = null
    if(process.env.HUGGINGFACE_API_TOKEN) {
      try{ qEmbedding = await hfEmbedding(q) }catch(e){ console.warn('embedding err',e) }
    }

    // gather candidate docs
    let docs = []
    if(qEmbedding){
      const snap = await getDb().collection('rag_embeddings').limit(200).get()
      snap.forEach(d=>{ const data = d.data(); if(data.embedding && Array.isArray(data.embedding)) docs.push({ id: d.id, score: cosine(qEmbedding, data.embedding), text: data.text || data.content || '', meta: data.meta || {} }) })
      docs.sort((a,b)=>b.score - a.score)
      docs = docs.slice(0, topK)
    } else {
      // fallback: simple text contains scoring
      const snap = await getDb().collection('rag_embeddings').limit(200).get()
      const ql = q.toLowerCase().split(/\s+/).filter(Boolean)
      snap.forEach(d=>{ const data = d.data(); const txt = (data.text||data.content||'').toLowerCase(); let cnt = 0; ql.forEach(w=>{ if(txt.includes(w)) cnt++ }); if(cnt>0) docs.push({ id:d.id, score:cnt, text: data.text||data.content||'', meta: data.meta||{} }) })
      docs.sort((a,b)=>b.score - a.score)
      docs = docs.slice(0, topK)
    }

    // Build prompt with sources
    const context = docs.map((d,i)=>`Source ${i+1} (id:${d.id}): ${d.text}`).join('\n\n')
    const prompt = `You are an assistant. Answer succinctly (1-3 sentences). Use only the provided sources below. If the answer is not in sources, say you don't know.\n\nSOURCES:\n${context}\n\nQUESTION: ${q}`

    // Call generators: Fireworks then HF fallback
    let genText = null
    console.log('Attempting generation...')
    console.log('Fireworks key exists:', !!process.env.FIREWORKS_API_KEY)
    console.log('HuggingFace key exists:', !!process.env.HUGGINGFACE_API_TOKEN)
    
    if(process.env.FIREWORKS_API_KEY){
      try{ 
        genText = await callFireworks(prompt)
        console.log('Fireworks succeeded')
      }catch(e){ 
        console.error('Fireworks failed:', e.message)
      }
    }
    if(!genText && process.env.HUGGINGFACE_API_TOKEN){
      try{ 
        genText = await callHFGen(prompt)
        console.log('HuggingFace succeeded')
      }catch(e){ 
        console.error('HuggingFace failed:', e.message)
      }
    }

    if(!genText){
      console.error('Both providers failed or returned null')
      return res.json({ 
        answer: 'No generation provider available or generation failed. Check server logs.', 
        sources: docs.map(d=>({ id:d.id, score:d.score })),
        debug: {
          hasFireworks: !!process.env.FIREWORKS_API_KEY,
          hasHF: !!process.env.HUGGINGFACE_API_TOKEN
        }
      })
    }

    const redacted = redactPII(genText)

    return res.json({ answer: redacted, sources: docs.map(d=>({ id:d.id, score:d.score })) })

  }catch(err){
    console.error('rag error', err)
    if(err && err.status) return res.status(err.status).json({ error: err.message || 'error' })
    return res.status(500).json({ error: (err && err.message) || 'internal' })
  }
}
