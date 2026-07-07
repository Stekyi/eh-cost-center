import React, { useState, useCallback, useRef } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'

interface DialogState {
  open: boolean
  title: string
  message: string
  promptLabel?: string
  promptValue: string
}

export function useConfirmDialog() {
  const [state, setState] = useState<DialogState>({
    open: false,
    title: '',
    message: '',
    promptLabel: undefined,
    promptValue: '',
  })

  // Store resolve function for the pending promise
  const resolveRef = useRef<((value: string | boolean | null) => void) | null>(null)

  const confirm = useCallback(
    (message: string, title = 'Confirm', promptLabel?: string): Promise<string | boolean | null> => {
      return new Promise((resolve) => {
        resolveRef.current = resolve
        setState({ open: true, title, message, promptLabel, promptValue: '' })
      })
    },
    []
  )

  const handleConfirm = () => {
    setState((s) => ({ ...s, open: false }))
    if (resolveRef.current) {
      resolveRef.current(state.promptLabel ? state.promptValue : true)
      resolveRef.current = null
    }
  }

  const handleCancel = () => {
    setState((s) => ({ ...s, open: false }))
    if (resolveRef.current) {
      resolveRef.current(null)
      resolveRef.current = null
    }
  }

  const ConfirmElement = (
    <Dialog open={state.open} onClose={handleCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{state.title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: state.promptLabel ? 2 : 0 }}>{state.message}</DialogContentText>
        {state.promptLabel && (
          <TextField
            autoFocus
            fullWidth
            label={state.promptLabel}
            value={state.promptValue}
            onChange={(e) => setState((s) => ({ ...s, promptValue: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm() }}
            size="small"
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel} color="inherit">Cancel</Button>
        <Button onClick={handleConfirm} variant="contained" color="primary">Confirm</Button>
      </DialogActions>
    </Dialog>
  )

  return { confirm, ConfirmElement }
}
