import React, { useState } from 'react'
import Modal from './Modal'
import { Box, TextField, Button, Typography } from '@mui/material'

import { callRag } from '../utils/ragClient'

type RagSource = { source: string; sourceId: string }

export default function ChatModal({ open, onClose }:{open:boolean,onClose:()=>void}){
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [sources, setSources] = useState<RagSource[]>([])

  async function handleAsk(){
    setLoading(true)
    setSources([])
    try{
      const res = await callRag(q, 5)
      setAnswer(res.answer || JSON.stringify(res))
      setSources(Array.isArray(res.sources) ? res.sources : [])
    }catch(e:any){
      setAnswer('Error: ' + (e.message || e))
    }finally{ setLoading(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Assistant">
      <Box sx={{ display: 'flex', gap: 1, flexDirection: 'column' }}>
        <TextField value={q} onChange={e=>setQ(e.target.value)} placeholder="Ask about customers, orders, expenses..." fullWidth multiline rows={2} />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="contained" onClick={handleAsk} disabled={loading || !q}>Ask</Button>
          <Button variant="outlined" onClick={onClose}>Close</Button>
        </Box>
        {answer && <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{answer}</Typography>}
        {sources.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">Sources</Typography>
            {sources.map((s, i) => (
              <Typography key={`${s.source}-${s.sourceId}-${i}`} variant="caption" display="block" color="text.secondary">
                {s.source} · {s.sourceId}
              </Typography>
            ))}
          </Box>
        )}
      </Box>
    </Modal>
  )
}
