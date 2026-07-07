import React, { useEffect, useState } from 'react'
import {
  useTheme,
  useMediaQuery,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Chip,
  Typography,
  CircularProgress,
} from '@mui/material'
import { createDoc } from '../utils/dataClient'
import { useLiveCollection } from '../hooks/useLiveCollection'
import { useSnackbar } from '../hooks/useSnackbar'

type Props = {
  open: boolean
  onClose: () => void
  onCreated?: (id: string) => void
}

export default function CreateCustomerModal({ open, onClose, onCreated }: Props) {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const { showError, SnackbarElement } = useSnackbar()

  const [name, setName] = useState('')
  const [telephone1, setTelephone1] = useState('')
  const [telephone2, setTelephone2] = useState('')
  const [dob, setDob] = useState('')
  const [city, setCity] = useState('')
  const [deliveryAddress1, setDeliveryAddress1] = useState('')
  const [deliveryAddress2, setDeliveryAddress2] = useState('')
  const [profile, setProfile] = useState('')
  const [categoryCodes, setCategoryCodes] = useState<string[]>([])
  const [allergyCodes, setAllergyCodes] = useState<string[]>([])
  const { docs: categoryDocs } = useLiveCollection('customerCategories')
  const { docs: allergyDocs } = useLiveCollection('customerAllergies')
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState('')

  const categories = React.useMemo(
    () => categoryDocs.filter((r: any) => r.active !== false).sort((a: any, b: any) => String(a.label || '').localeCompare(String(b.label || ''))),
    [categoryDocs],
  )
  const allergies = React.useMemo(
    () => allergyDocs.filter((r: any) => r.active !== false).sort((a: any, b: any) => String(a.label || '').localeCompare(String(b.label || ''))),
    [allergyDocs],
  )

  useEffect(() => {
    if (!open) {
      setName(''); setTelephone1(''); setTelephone2(''); setDob(''); setCity('')
      setDeliveryAddress1(''); setDeliveryAddress2(''); setProfile('')
      setCategoryCodes([]); setAllergyCodes([]); setSaving(false); setNameError('')
    }
  }, [open])

  function toggleCode(code: string, selected: string[], setSelected: React.Dispatch<React.SetStateAction<string[]>>) {
    setSelected((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]))
  }

  async function handleCreate(e?: React.FormEvent) {
    e?.preventDefault()
    setNameError('')
    if (!name.trim()) {
      setNameError('Name is required')
      return
    }
    setSaving(true)
    try {
      const ref = await createDoc('customers', {
        name: name.trim(),
        telephone1: telephone1.trim(),
        telephone2: telephone2.trim(),
        dob: dob || null,
        city: city || null,
        deliveryAddress1: deliveryAddress1 || null,
        deliveryAddress2: deliveryAddress2 || null,
        profile: profile || null,
        categoryCodes,
        allergyCodes,
      })
      onCreated && onCreated(ref.id)
      onClose()
    } catch (err: any) {
      console.error('CreateCustomerModal:create failed', err)
      showError(err?.message || 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {SnackbarElement}
      <Dialog
        open={open}
        onClose={onClose}
        fullScreen={isMobile}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: isMobile ? 0 : 3 } }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6" fontWeight={700}>Add New Customer</Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Box
            component="form"
            id="create-customer-form"
            onSubmit={handleCreate}
            sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2, pt: 0.5 }}
          >
            <Box sx={{ gridColumn: '1 / -1' }}>
              <TextField
                label="Full Name *"
                value={name}
                onChange={(e) => { setName(e.target.value); setNameError('') }}
                fullWidth
                size="small"
                error={!!nameError}
                helperText={nameError}
                autoFocus
              />
            </Box>
            <TextField
              label="Phone 1"
              value={telephone1}
              onChange={(e) => setTelephone1(e.target.value)}
              fullWidth
              size="small"
              inputProps={{ type: 'tel' }}
            />
            <TextField
              label="Phone 2"
              value={telephone2}
              onChange={(e) => setTelephone2(e.target.value)}
              fullWidth
              size="small"
              inputProps={{ type: 'tel' }}
            />
            <TextField
              label="Date of Birth"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              fullWidth
              size="small"
            />
            <Box sx={{ gridColumn: '1 / -1' }}>
              <TextField
                label="Delivery Address 1"
                value={deliveryAddress1}
                onChange={(e) => setDeliveryAddress1(e.target.value)}
                fullWidth
                size="small"
              />
            </Box>
            <Box sx={{ gridColumn: '1 / -1' }}>
              <TextField
                label="Delivery Address 2"
                value={deliveryAddress2}
                onChange={(e) => setDeliveryAddress2(e.target.value)}
                fullWidth
                size="small"
              />
            </Box>
            <Box sx={{ gridColumn: '1 / -1' }}>
              <TextField
                label="Profile Notes"
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                fullWidth
                size="small"
                multiline
                rows={2}
              />
            </Box>

            {/* Categories */}
            <Box sx={{ gridColumn: '1 / -1' }}>
              <Typography variant="body2" fontWeight={500} sx={{ mb: 1 }}>Customer Categories</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {categories.map((c) => (
                  <Chip
                    key={c.id || c.code}
                    label={c.label}
                    size="small"
                    clickable
                    onClick={() => toggleCode(String(c.code), categoryCodes, setCategoryCodes)}
                    variant={categoryCodes.includes(String(c.code)) ? 'filled' : 'outlined'}
                    color={categoryCodes.includes(String(c.code)) ? 'primary' : 'default'}
                  />
                ))}
                {categories.length === 0 && <Typography variant="caption" color="text.secondary">No categories configured</Typography>}
              </Box>
            </Box>

            {/* Allergies */}
            <Box sx={{ gridColumn: '1 / -1' }}>
              <Typography variant="body2" fontWeight={500} sx={{ mb: 1 }}>Allergies</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {allergies.map((a) => (
                  <Chip
                    key={a.id || a.code}
                    label={a.label}
                    size="small"
                    clickable
                    onClick={() => toggleCode(String(a.code), allergyCodes, setAllergyCodes)}
                    variant={allergyCodes.includes(String(a.code)) ? 'filled' : 'outlined'}
                    color={allergyCodes.includes(String(a.code)) ? 'error' : 'default'}
                  />
                ))}
                {allergies.length === 0 && <Typography variant="caption" color="text.secondary">No allergies configured</Typography>}
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
          <Button variant="outlined" onClick={onClose} fullWidth={isMobile}>Cancel</Button>
          <Button
            variant="contained"
            type="submit"
            form="create-customer-form"
            disabled={saving}
            fullWidth={isMobile}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {saving ? 'Saving...' : 'Create Customer'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
