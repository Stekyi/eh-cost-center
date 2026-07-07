import React, { useState, useCallback } from 'react'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'

type Severity = 'success' | 'error' | 'info' | 'warning'

interface SnackbarState {
  open: boolean
  message: string
  severity: Severity
}

export function useSnackbar() {
  const [state, setState] = useState<SnackbarState>({ open: false, message: '', severity: 'success' })

  const show = useCallback((message: string, severity: Severity) => {
    setState({ open: true, message, severity })
  }, [])

  const showSuccess = useCallback((message: string) => show(message, 'success'), [show])
  const showError = useCallback((message: string) => show(message, 'error'), [show])
  const showInfo = useCallback((message: string) => show(message, 'info'), [show])

  const handleClose = (_: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') return
    setState((s) => ({ ...s, open: false }))
  }

  const SnackbarElement = (
    <Snackbar
      open={state.open}
      autoHideDuration={4000}
      onClose={handleClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert onClose={handleClose} severity={state.severity} variant="filled" sx={{ width: '100%' }}>
        {state.message}
      </Alert>
    </Snackbar>
  )

  return { showSuccess, showError, showInfo, SnackbarElement }
}
