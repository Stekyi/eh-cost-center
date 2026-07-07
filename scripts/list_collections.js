#!/usr/bin/env node
const admin = require('firebase-admin')
try { admin.initializeApp({ credential: admin.credential.applicationDefault() }) } catch(e){ console.error(e); process.exit(1) }
const db = admin.firestore()

async function run(){
  const colSnaps = await db.listCollections()
  console.log('Top-level collections:')
  for(const c of colSnaps){
    const name = c.id
    const docs = await c.limit(5).get()
    console.log(`- ${name} (sample ${docs.size})`)
    docs.forEach(d=>{
      console.log('  ', d.id, JSON.stringify(d.data()))
    })
  }
}
run().catch(e=>{ console.error(e); process.exit(1) })
