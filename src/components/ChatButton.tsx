import React, { useState } from 'react'
import Fab from '@mui/material/Fab'
import ChatIcon from '@mui/icons-material/Chat'
import ChatModal from './ChatModal'

// TEMPORARY: show chat button to everyone for testing. Revert to admin-only later.
export default function ChatButton(){
  const [open, setOpen] = useState(false)
  return (
    <>
      <Fab color="primary" onClick={()=>setOpen(true)} style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 1400 }}>
        <ChatIcon />
      </Fab>
      <ChatModal open={open} onClose={()=>setOpen(false)} />
    </>
  )
}
