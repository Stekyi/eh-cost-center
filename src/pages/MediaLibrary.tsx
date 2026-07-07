import React, { useRef, useState } from 'react'
// ── MIGRATED to Neon compat layer (Firestore + Storage→R2, role via RoleContext) ──
// Was: import { db, auth, storage } from '../utils/firebaseClient'
//      import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
//      import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'
import { createDoc, updateDocById, deleteDocById, uploadMedia } from '../utils/dataClient'
import { useLiveCollection } from '../hooks/useLiveCollection'
import { useRole } from '../utils/RoleContext'
import '../styles.css'

/* ─────────────────────────────────────────────
   Types
──────────────────────────────────────────────*/
interface GalleryItem {
  id: string
  url: string
  storageRef: string
  label: string
  type: 'image' | 'video'
  taggedProductIds: string[]
  taggedProductNames: string[]
  active: boolean
  createdAt: any
}

interface Product {
  id: string
  name: string
  type: 'juice' | 'meal'
  imageUrl?: string
}

/* ─────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────*/
function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

// NOTE: R2 upload (uploadMedia) has no progress callback — the per-file % bar
// was replaced with an indeterminate spinner during upload (see UploadModal).

/* ─────────────────────────────────────────────
   Tag chips component
──────────────────────────────────────────────*/
function TagChips({
  item,
  products,
  onTag,
  onUntag,
}: {
  item: GalleryItem
  products: Product[]
  onTag: (item: GalleryItem, product: Product) => void
  onUntag: (item: GalleryItem, productId: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')

  const untagged = products.filter(
    (p) => !item.taggedProductIds.includes(p.id) &&
      p.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 12, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Tagged to
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {item.taggedProductNames.map((name, i) => (
          <span
            key={item.taggedProductIds[i]}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: '#dbeafe', color: '#1d4ed8', borderRadius: 20,
              padding: '2px 10px', fontSize: 12, fontWeight: 600,
            }}
          >
            {name}
            <button
              onClick={() => onUntag(item, item.taggedProductIds[i])}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1d4ed8', fontWeight: 700, fontSize: 14, lineHeight: 1, padding: 0 }}
              title="Untag"
            >×</button>
          </span>
        ))}
        {item.taggedProductIds.length === 0 && (
          <span style={{ color: '#9ca3af', fontSize: 12 }}>No tags yet</span>
        )}
      </div>
      {adding ? (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#f9fafb' }}>
          <input
            className="input"
            placeholder="Search product…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            style={{ marginBottom: 6 }}
          />
          <div style={{ maxHeight: 160, overflowY: 'auto' }}>
            {untagged.length === 0 && (
              <div style={{ color: '#9ca3af', fontSize: 13, padding: '4px 0' }}>No products found</div>
            )}
            {untagged.map((p) => (
              <div
                key={p.id}
                onClick={() => { onTag(item, p); setAdding(false); setSearch('') }}
                style={{
                  padding: '6px 8px', cursor: 'pointer', borderRadius: 6, fontSize: 13,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  fontSize: 10, fontWeight: 700, background: p.type === 'juice' ? '#d1fae5' : '#fce7f3',
                  color: p.type === 'juice' ? '#065f46' : '#9d174d', borderRadius: 4, padding: '1px 5px',
                }}>{p.type}</span>
                {p.name}
              </div>
            ))}
          </div>
          <button className="btn" onClick={() => { setAdding(false); setSearch('') }} style={{ marginTop: 6, fontSize: 12 }}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="btn btn-primary"
          style={{ fontSize: 12, padding: '4px 12px' }}
          onClick={() => setAdding(true)}
        >
          + Tag to product
        </button>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Media card
──────────────────────────────────────────────*/
function MediaCard({
  item,
  products,
  onTag,
  onUntag,
  onDelete,
  onToggleActive,
}: {
  item: GalleryItem
  products: Product[]
  onTag: (item: GalleryItem, product: Product) => void
  onUntag: (item: GalleryItem, productId: string) => void
  onDelete: (item: GalleryItem) => void
  onToggleActive: (item: GalleryItem) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden',
      background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
      display: 'flex', flexDirection: 'column',
      opacity: item.active ? 1 : 0.55,
    }}>
      {/* Thumbnail */}
      <div style={{ position: 'relative', width: '100%', paddingBottom: '66%', background: '#f3f4f6', overflow: 'hidden' }}>
        {item.type === 'image' ? (
          <img
            src={item.url}
            alt={item.label}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 40 }}>🎬</span>
            <a href={item.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb' }}>Play video</a>
          </div>
        )}
        {/* Active badge */}
        <span style={{
          position: 'absolute', top: 6, right: 6,
          background: item.active ? '#10b981' : '#9ca3af',
          color: '#fff', borderRadius: 20, fontSize: 10, fontWeight: 700,
          padding: '2px 7px', textTransform: 'uppercase',
        }}>{item.active ? 'Active' : 'Hidden'}</span>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontWeight: 600, fontSize: 14, wordBreak: 'break-word' }}>{item.label}</div>
        <div style={{ fontSize: 11, color: '#9ca3af' }}>
          {item.taggedProductIds.length} product{item.taggedProductIds.length !== 1 ? 's' : ''} tagged
        </div>

        {/* Expand/collapse tag manager */}
        <button
          className="btn"
          style={{ fontSize: 12, padding: '4px 10px', alignSelf: 'flex-start' }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Hide tags ▲' : 'Manage tags ▼'}
        </button>

        {expanded && (
          <TagChips item={item} products={products} onTag={onTag} onUntag={onUntag} />
        )}
      </div>

      {/* Actions */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #f3f4f6', display: 'flex', gap: 6 }}>
        <button
          className="btn"
          style={{ fontSize: 12, flex: 1 }}
          onClick={() => onToggleActive(item)}
        >
          {item.active ? 'Hide' : 'Show'}
        </button>
        <button
          className="btn btn-danger"
          style={{ fontSize: 12 }}
          onClick={() => onDelete(item)}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Upload Modal
──────────────────────────────────────────────*/
function UploadModal({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const [files, setFiles] = useState<File[]>([])
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function pickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || [])
    setFiles((prev) => {
      const merged = [...prev]
      picked.forEach((f) => { if (!merged.find((x) => x.name === f.name && x.size === f.size)) merged.push(f) })
      return merged
    })
    // default label = filename without extension
    setLabels((prev) => {
      const next = { ...prev }
      picked.forEach((f) => { if (!next[f.name + f.size]) next[f.name + f.size] = f.name.replace(/\.[^/.]+$/, '') })
      return next
    })
  }

  function removeFile(f: File) {
    setFiles((prev) => prev.filter((x) => x !== f))
  }

  async function upload() {
    if (files.length === 0) { alert('Select at least one file'); return }
    for (const f of files) {
      if (!labels[f.name + f.size]?.trim()) { alert(`Enter a label for: ${f.name}`); return }
    }
    setUploading(true)
    try {
      for (const f of files) {
        const tempId = Date.now() + '_' + Math.random().toString(36).slice(2)
        const storagePath = `gallery/${tempId}/${f.name}`
        // R2 upload — returns { url, key }. Store url in `url`, key in `storageRef`.
        const { url, key } = await uploadMedia(f, storagePath)
        const isVideo = f.type.startsWith('video/')
        await createDoc('gallery', {
          url,
          storageRef: key,
          label: labels[f.name + f.size].trim(),
          type: isVideo ? 'video' : 'image',
          taggedProductIds: [],
          taggedProductNames: [],
          active: true,
        })
      }
      onClose()
    } catch (err: any) {
      console.error('MediaLibrary:upload failed', err)
      alert(err?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1300, padding: 16,
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: 24, width: '100%',
        maxWidth: 560, maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <style>{`@keyframes ml-indet { 0% { left: -40%; } 100% { left: 100%; } }`}</style>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Upload Media</h2>
          <button className="btn" onClick={onClose} disabled={uploading}>✕</button>
        </div>

        {/* Drop zone */}
        <div
          style={{
            border: '2px dashed #d1d5db', borderRadius: 12, padding: '32px 16px',
            textAlign: 'center', cursor: 'pointer', marginBottom: 16,
            background: '#f9fafb', transition: 'border-color 0.2s',
          }}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const dt = e.dataTransfer.files
            if (dt) {
              const synth = { target: { files: dt } } as any
              pickFiles(synth)
            }
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 8 }}>📁</div>
          <div style={{ fontWeight: 600, color: '#374151' }}>Click or drag & drop files here</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>Images (JPG, PNG, WEBP, GIF) and Videos (MP4, MOV)</div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            style={{ display: 'none' }}
            onChange={pickFiles}
          />
        </div>

        {/* File list */}
        {files.map((f) => {
          const key = f.name + f.size
          return (
            <div key={key} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                {f.type.startsWith('image/') ? (
                  <img
                    src={URL.createObjectURL(f)}
                    alt=""
                    style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                  />
                ) : (
                  <div style={{ width: 52, height: 52, borderRadius: 8, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 24 }}>🎬</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name} ({formatBytes(f.size)})</div>
                  <input
                    className="input"
                    placeholder="Label (required)"
                    value={labels[key] || ''}
                    onChange={(e) => setLabels((prev) => ({ ...prev, [key]: e.target.value }))}
                    style={{ fontSize: 13 }}
                  />
                </div>
                <button className="btn btn-danger" style={{ fontSize: 12 }} onClick={() => removeFile(f)} disabled={uploading}>✕</button>
              </div>
              {/* R2 upload has no progress events — show an indeterminate bar while uploading */}
              {uploading && (
                <div style={{ height: 4, background: '#e5e7eb', borderRadius: 99, overflow: 'hidden', position: 'relative' }}>
                  <div className="ml-indeterminate" style={{ height: '100%', background: '#2563eb', width: '40%', borderRadius: 99, position: 'absolute', animation: 'ml-indet 1.1s ease-in-out infinite' }} />
                </div>
              )}
            </div>
          )
        })}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn" onClick={onClose} disabled={uploading}>Cancel</button>
          <button className="btn btn-primary" onClick={upload} disabled={uploading || files.length === 0}>
            {uploading ? 'Uploading…' : `Upload ${files.length > 0 ? `(${files.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Main page
──────────────────────────────────────────────*/
export default function MediaLibrary() {
  // Role gating replaces Firebase auth claims (admin/videographer).
  const role = useRole()
  const canManageMedia = role === 'admin' || role === 'videographer'
  const accessReady = role !== null
  const [tab, setTab] = useState<'library' | 'byProduct'>('library')
  const [showUpload, setShowUpload] = useState(false)

  // Library tab filters
  const [searchLabel, setSearchLabel] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'image' | 'video'>('all')
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'hidden'>('all')

  // By Product tab
  const [productSearch, setProductSearch] = useState('')
  const [productTypeFilter, setProductTypeFilter] = useState<'all' | 'juice' | 'meal'>('all')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  // onSnapshot(query(collection(db,'gallery'), orderBy('createdAt','desc'))) → polling hook
  const { docs: galleryDocs, refresh: refreshGallery } = useLiveCollection('gallery', { orderBy: { field: 'createdAt', dir: 'desc' } })
  const { docs: productDocs } = useLiveCollection('products')
  const gallery = galleryDocs as unknown as GalleryItem[]
  const products = (productDocs as unknown as Product[]).slice().sort((a, b) => a.name.localeCompare(b.name))

  if (!accessReady) {
    return <div className="page-container"><div className="card">Loading media access…</div></div>
  }

  if (!canManageMedia) {
    return <div className="page-container"><div className="card">You do not have permission to manage the media library.</div></div>
  }

  // ── Tag / Untag ──
  async function handleTag(item: GalleryItem, product: Product) {
    try {
      const newIds = [...item.taggedProductIds, product.id]
      const newNames = [...item.taggedProductNames, product.name]
      await updateDocById('gallery', item.id, {
        taggedProductIds: newIds,
        taggedProductNames: newNames,
      })
      refreshGallery()
    } catch (err: any) {
      console.error('MediaLibrary:tag failed', err)
      alert(err?.message || 'Failed to tag')
    }
  }

  async function handleUntag(item: GalleryItem, productId: string) {
    try {
      const idx = item.taggedProductIds.indexOf(productId)
      const newIds = item.taggedProductIds.filter((_, i) => i !== idx)
      const newNames = item.taggedProductNames.filter((_, i) => i !== idx)
      await updateDocById('gallery', item.id, {
        taggedProductIds: newIds,
        taggedProductNames: newNames,
      })
      refreshGallery()
    } catch (err: any) {
      console.error('MediaLibrary:untag failed', err)
      alert(err?.message || 'Failed to untag')
    }
  }

  async function handleDelete(item: GalleryItem) {
    if (!confirm(`Delete "${item.label}"? This cannot be undone.`)) return
    try {
      // TODO: R2 object cleanup for ${item.storageRef} — no R2 delete endpoint yet.
      // storageRef is kept on the doc so the object can be reclaimed later.
      await deleteDocById('gallery', item.id)
      refreshGallery()
    } catch (err: any) {
      console.error('MediaLibrary:delete failed', err)
      alert(err?.message || 'Failed to delete')
    }
  }

  async function handleToggleActive(item: GalleryItem) {
    try {
      await updateDocById('gallery', item.id, { active: !item.active })
      refreshGallery()
    } catch (err: any) {
      console.error('MediaLibrary:toggleActive failed', err)
      alert(err?.message || 'Failed to update')
    }
  }

  // ── Filtered galleries ──
  const filteredLibrary = gallery.filter((item) => {
    if (filterType !== 'all' && item.type !== filterType) return false
    if (filterActive === 'active' && !item.active) return false
    if (filterActive === 'hidden' && item.active) return false
    if (searchLabel && !item.label.toLowerCase().includes(searchLabel.toLowerCase())) return false
    return true
  })

  const filteredProducts = products.filter((p) => {
    if (productTypeFilter !== 'all' && p.type !== productTypeFilter) return false
    if (productSearch && !p.name.toLowerCase().includes(productSearch.toLowerCase())) return false
    return true
  })

  const productGallery = selectedProduct
    ? gallery.filter((item) => item.taggedProductIds.includes(selectedProduct.id))
    : []

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 16,
  }

  // ── Tab button style ──
  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '8px 22px', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontWeight: 600, fontSize: 14, transition: 'all 0.15s',
    background: active ? '#2563eb' : '#f3f4f6',
    color: active ? '#fff' : '#374151',
  })

  return (
    <div className="page-container">
      <div className="header">
        <h1>Media Library</h1>
        <button className="btn btn-primary" onClick={() => setShowUpload(true)}>
          + Upload Media
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button style={tabBtn(tab === 'library')} onClick={() => setTab('library')}>
          📷 Library ({gallery.length})
        </button>
        <button style={tabBtn(tab === 'byProduct')} onClick={() => setTab('byProduct')}>
          🏷️ By Product
        </button>
      </div>

      {/* ═══════════════════════════ TAB 1: LIBRARY ═══════════════════════════ */}
      {tab === 'library' && (
        <div className="card">
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
            <input
              className="input"
              placeholder="Search by label…"
              value={searchLabel}
              onChange={(e) => setSearchLabel(e.target.value)}
              style={{ minWidth: 200 }}
            />
            <select className="select" value={filterType} onChange={(e) => setFilterType(e.target.value as any)}>
              <option value="all">All types</option>
              <option value="image">Images only</option>
              <option value="video">Videos only</option>
            </select>
            <select className="select" value={filterActive} onChange={(e) => setFilterActive(e.target.value as any)}>
              <option value="all">All</option>
              <option value="active">Active only</option>
              <option value="hidden">Hidden only</option>
            </select>
            <button className="btn" onClick={() => { setSearchLabel(''); setFilterType('all'); setFilterActive('all') }}>
              Reset
            </button>
            <span style={{ marginLeft: 'auto', fontSize: 13, color: '#6b7280' }}>
              {filteredLibrary.length} item{filteredLibrary.length !== 1 ? 's' : ''}
            </span>
          </div>

          {filteredLibrary.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#9ca3af' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🖼️</div>
              <div style={{ fontWeight: 600 }}>No media found</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Upload images or videos using the button above</div>
            </div>
          ) : (
            <div style={gridStyle}>
              {filteredLibrary.map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  products={products}
                  onTag={handleTag}
                  onUntag={handleUntag}
                  onDelete={handleDelete}
                  onToggleActive={handleToggleActive}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════ TAB 2: BY PRODUCT ═══════════════════════════ */}
      {tab === 'byProduct' && (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
          {/* Product picker */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Products</div>
            <input
              className="input"
              placeholder="Search products…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <select
              className="select"
              value={productTypeFilter}
              onChange={(e) => setProductTypeFilter(e.target.value as any)}
              style={{ marginBottom: 12 }}
            >
              <option value="all">All</option>
              <option value="juice">Juices</option>
              <option value="meal">Meals</option>
            </select>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '60vh', overflowY: 'auto' }}>
              {filteredProducts.map((p) => {
                const tagCount = gallery.filter((g) => g.taggedProductIds.includes(p.id)).length
                const isSelected = selectedProduct?.id === p.id
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedProduct(p)}
                    style={{
                      padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                      background: isSelected ? '#dbeafe' : 'transparent',
                      border: isSelected ? '1px solid #93c5fd' : '1px solid transparent',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#f3f4f6' }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{
                          fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 5px', marginRight: 6,
                          background: p.type === 'juice' ? '#d1fae5' : '#fce7f3',
                          color: p.type === 'juice' ? '#065f46' : '#9d174d',
                        }}>{p.type}</span>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</span>
                      </div>
                      <span style={{
                        fontSize: 11, fontWeight: 700, background: tagCount > 0 ? '#dbeafe' : '#f3f4f6',
                        color: tagCount > 0 ? '#1d4ed8' : '#9ca3af', borderRadius: 20,
                        padding: '1px 7px', minWidth: 20, textAlign: 'center',
                      }}>{tagCount}</span>
                    </div>
                  </div>
                )
              })}
              {filteredProducts.length === 0 && (
                <div style={{ color: '#9ca3af', fontSize: 13, padding: 8 }}>No products found</div>
              )}
            </div>
          </div>

          {/* Tagged images panel */}
          <div className="card">
            {!selectedProduct ? (
              <div style={{ textAlign: 'center', padding: '80px 0', color: '#9ca3af' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>👈</div>
                <div style={{ fontWeight: 600 }}>Select a product to see its tagged media</div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <span style={{
                      fontSize: 11, fontWeight: 700, borderRadius: 4, padding: '2px 7px', marginRight: 8,
                      background: selectedProduct.type === 'juice' ? '#d1fae5' : '#fce7f3',
                      color: selectedProduct.type === 'juice' ? '#065f46' : '#9d174d',
                    }}>{selectedProduct.type.toUpperCase()}</span>
                    <span style={{ fontWeight: 700, fontSize: 18 }}>{selectedProduct.name}</span>
                  </div>
                  <span style={{ color: '#6b7280', fontSize: 13 }}>
                    {productGallery.length} image{productGallery.length !== 1 ? 's' : ''} tagged
                  </span>
                </div>

                {productGallery.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: '#9ca3af' }}>
                    <div style={{ fontSize: 40, marginBottom: 10 }}>🖼️</div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>No images tagged yet</div>
                    <div style={{ fontSize: 13 }}>Go to the Library tab, open an image and tag it to this product</div>
                  </div>
                ) : (
                  <div style={gridStyle}>
                    {productGallery.map((item) => (
                      <MediaCard
                        key={item.id}
                        item={item}
                        products={products}
                        onTag={handleTag}
                        onUntag={handleUntag}
                        onDelete={handleDelete}
                        onToggleActive={handleToggleActive}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showUpload && <UploadModal products={products} onClose={() => { setShowUpload(false); refreshGallery() }} />}
    </div>
  )
}
