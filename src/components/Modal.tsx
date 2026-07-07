import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import '../styles.css'

type ModalProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}

const Modal: React.FC<ModalProps> = ({ open, onClose, title, children }) => {
  const elRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)

  if (!elRef.current && typeof document !== 'undefined') {
    elRef.current = document.createElement('div')
  }

  useEffect(() => {
    const host = document.body
    const node = elRef.current!
    host.appendChild(node)
    return () => {
      try { host.removeChild(node) } catch (e) { /* ignore */ }
    }
  }, [])

  if (!open) return null

  const handleOverlayClick = (e: React.MouseEvent) => {
    // only close when clicking the overlay itself (not child elements)
    if (overlayRef.current && e.target === overlayRef.current) onClose()
  }

  const modal = (
    <div className="modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {title && <h3 style={{ marginTop: 0, marginBottom: 12 }}>{title}</h3>}
        {children}
      </div>
    </div>
  )

  return createPortal(modal, elRef.current!)
}

export default Modal