import React, { useState } from 'react'
import { login as authLogin, requestReset } from '../utils/authClient'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resetEmail, setResetEmail] = useState('')
  const [resetMessage, setResetMessage] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    // Self-hosted JWT login (Neon). Username field is the email. On success,
    // authClient notifies App's onChange subscriber, which handles navigation.
    authLogin(username, password)
      .catch((err: any) => setError(
        err?.message === 'password_reset_required'
          ? 'Password reset required — use the reset box below.'
          : err?.message === 'invalid' ? 'Invalid email or password' : (err?.message || 'Login failed')))
      .finally(() => setLoading(false))
  }

  const sendReset = async (e?: React.FormEvent) => {
    e && e.preventDefault()
    setResetMessage('')
    if (!resetEmail) { setResetMessage('Enter email to reset'); return }
    try {
      await requestReset(resetEmail)
      setResetMessage('If that email exists, a reset link has been sent.')
    } catch (err:any) {
      setResetMessage(err.message || 'Failed to send reset email')
    }
  }

  return (
    <div style={{ 
      minHeight: '80vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div className="card" style={{ 
        maxWidth: '480px', 
        width: '100%',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ 
            fontSize: '32px', 
            fontWeight: '700', 
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            marginBottom: '8px'
          }}>
            EH Cost Center
          </div>
          <p style={{ color: 'var(--text-light)', fontSize: '14px' }}>Sign in with your staff email</p>
        </div>
        <form onSubmit={submit}>
          <div style={{ marginBottom: '20px' }}>
            <label htmlFor="username">Email</label>
            <input 
              id="username"
              className="input"
              style={{ maxWidth: '100%' }}
              value={username} 
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              required
            />
          </div>
          <div style={{ marginBottom: '24px' }}>
            <label htmlFor="password">Password</label>
            <input 
              id="password"
              className="input"
              style={{ maxWidth: '100%' }}
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>
          {error && <div style={{ color: '#dc2626', marginBottom: '16px', fontSize: '14px' }}>{error}</div>}
          <button 
            type="submit" 
            className="btn btn-primary" 
            style={{ width: '100%', fontSize: '16px', padding: '14px' }}
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div style={{ padding: '16px', borderTop: '1px solid var(--muted)', marginTop: '8px' }}>
          <form onSubmit={sendReset} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input placeholder="email for password reset" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} className="input" style={{ flex: 1 }} />
            <button className="btn" onClick={sendReset} type="submit">Reset</button>
          </form>
          {resetMessage && <div style={{ marginTop: 8, fontSize: 13 }}>{resetMessage}</div>}
        </div>
      </div>
    </div>
  )
}
