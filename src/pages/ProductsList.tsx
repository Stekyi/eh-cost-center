import React, { useState } from 'react';
// ── MIGRATED to Neon compat layer (Firestore + Storage→R2) ──
// Was: import { db, auth, storage } from '../utils/firebaseClient'
//      import { collection, addDoc, onSnapshot, query, deleteDoc, doc, updateDoc, getDocs, getDoc, serverTimestamp, where, limit } from 'firebase/firestore'
//      import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { createDoc, updateDocById, deleteDocById, getDocById, listDocs, uploadMedia, where } from '../utils/dataClient';
import { useLiveCollection } from '../hooks/useLiveCollection';
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  Fab,
  Chip,
  FormControlLabel,
  Checkbox,
  MenuItem,
  IconButton,
  CircularProgress,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import * as XLSX from 'xlsx';
import type { GridColDef } from '@mui/x-data-grid';
import ResponsiveDataGrid from '../components/ResponsiveDataGrid';
import { useSnackbar } from '../hooks/useSnackbar';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

const DEFAULT_JUICES = [
  'PCOS', 'Fibroids', 'Weight Loss Challenges', 'Diabetes',
  'Hypertension', 'Cholesterol', 'Belly Fat', 'Skin Issues',
  'Hormonal Imbalance', 'Anti-Inflammatory',
];
const DEFAULT_MEALS = ['low carb meal', 'weightloss meal', 'Renal Support Meal Plan'];

const PRODUCT_TYPES = [
  { value: 'juice', label: 'Juice' },
  { value: 'meal', label: 'Meal' },
  { value: 'shot', label: 'Shot' },
  { value: 'package', label: 'Package' },
];

export default function ProductsList() {
  const { docs: products, refresh } = useLiveCollection('products');
  const { docs: customerCategoriesRaw } = useLiveCollection('customerCategories');
  const customerCategories = customerCategoriesRaw.filter((c) => c.active !== false);
  const [filterName, setFilterName] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [uploading, setUploading] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editAudioFile, setEditAudioFile] = useState<File | null>(null);

  // Add form state
  const [name, setName] = useState('');
  const [type, setType] = useState<'juice' | 'meal' | 'shot' | 'package'>('juice');
  const [unitCost, setUnitCost] = useState<number>(0);
  const [unitsPerPackage, setUnitsPerPackage] = useState<number>(1);
  const [description, setDescription] = useState('');
  const [bestSeller, setBestSeller] = useState(false);
  const [promo, setPromo] = useState(false);
  const [healthTags, setHealthTags] = useState<string[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [active, setActive] = useState(true);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { showSuccess, showError, SnackbarElement } = useSnackbar();
  const { confirm, ConfirmElement } = useConfirmDialog();

  const filteredRows = React.useMemo(() => {
    const q = String(filterName || '').trim().toLowerCase();
    return products
      .filter((p) => !!p?.id)
      .filter((p) => (filterType === 'all' ? true : String(p.type || '').toLowerCase() === filterType))
      .filter((p) => (q ? String(p.name || '').toLowerCase().includes(q) : true));
  }, [products, filterName, filterType]);

  async function uploadFile(key: string, file: File): Promise<string> {
    const { url } = await uploadMedia(file, key);
    return url;
  }

  function resetAddForm() {
    setName(''); setType('juice'); setUnitCost(0); setUnitsPerPackage(1);
    setDescription(''); setActive(true); setBestSeller(false); setPromo(false);
    setHealthTags([]); setImageFile(null); setAudioFile(null);
  }

  async function createProduct(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const upperName = name.trim().toUpperCase();
    if (!upperName) { showError('Product name is required'); return; }
    if (products.some((p) => p.name?.toUpperCase() === upperName)) {
      showError('Product name must be unique. Please choose a different name.'); return;
    }
    setUploading(true);
    try {
      const productData: any = {
        name: upperName, type, unitCost: Number(unitCost), unitsPerPackage: Number(unitsPerPackage),
        description: description || '', active: !!active, bestSeller: !!bestSeller, promo: !!promo,
        healthTags: healthTags || [], avgRating: 0, reviewCount: 0, weeklyOrderCount: 0,
      };
      const docRef = await createDoc('products', productData);
      const updates: any = {};
      if (imageFile) updates.imageUrl = await uploadFile(`products/${docRef.id}/image`, imageFile);
      if (audioFile) updates.audioUrl = await uploadFile(`products/${docRef.id}/audio`, audioFile);
      if (Object.keys(updates).length) await updateDocById('products', docRef.id, updates);
      resetAddForm();
      setIsAddOpen(false);
      showSuccess('Product created!');
      refresh();
    } catch (err: any) {
      showError(err?.message || 'Failed to create product');
    } finally {
      setUploading(false);
    }
  }

  async function removeProduct(id: string) {
    const ok = await confirm('Delete this product?', 'Delete Product');
    if (!ok) return;
    try {
      const referencingOrders = await listDocs('orders', { where: [where('productIds', 'array-contains', id)], limit: 1 });
      if (referencingOrders.length > 0) { showError('Cannot delete product: it is referenced by existing orders.'); return; }
      await deleteDocById('products', id);
      showSuccess('Product deleted.');
      refresh();
    } catch (err: any) {
      showError(err?.message || 'Failed to delete product');
    }
  }

  function openEditModal(product: any) {
    setEditingProduct({
      ...product,
      description: product.description || '',
      active: product.active !== false,
      bestSeller: !!product.bestSeller,
      promo: !!product.promo,
      healthTags: product.healthTags || [],
    });
    setEditImageFile(null);
    setEditAudioFile(null);
  }

  async function saveEditedProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!editingProduct) return;
    setUploading(true);
    try {
      const { id, imageUrl: _img, audioUrl: _aud, avgRating: _ar, reviewCount: _rc,
        weeklyOrderCount: _woc, createdAt: _ca, createdBy: _cb, modifiedAt: _ma, modifiedBy: _mb, ...updatedData } = editingProduct;
      const existing = await getDocById('products', id);
      if (existing) {
        await createDoc('product_audit', {
          productId: id, oldData: existing, updatedData,
        });
      }
      const fileUpdates: any = {};
      if (editImageFile) fileUpdates.imageUrl = await uploadFile(`products/${id}/image`, editImageFile);
      if (editAudioFile) fileUpdates.audioUrl = await uploadFile(`products/${id}/audio`, editAudioFile);
      await updateDocById('products', id, {
        ...updatedData, ...fileUpdates,
      });
      setEditingProduct(null);
      setEditImageFile(null);
      setEditAudioFile(null);
      showSuccess('Product updated!');
      refresh();
    } catch (err: any) {
      showError(err?.message || 'Failed to save product edits');
    } finally {
      setUploading(false);
    }
  }

  function exportFilteredProducts() {
    try {
      const data = filteredRows.map(({ id, ...rest }: any) => ({ id, ...rest }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Products');
      XLSX.writeFile(wb, `products_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      showError('Failed to export products');
    }
  }

  function HealthTagChips({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
    return (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.5 }}>
        {customerCategories.map((cat) => {
          const selected = tags.includes(cat.code);
          return (
            <Chip
              key={cat.code}
              label={cat.label}
              size="small"
              variant={selected ? 'filled' : 'outlined'}
              color={selected ? 'primary' : 'default'}
              onClick={() => onChange(selected ? tags.filter((t) => t !== cat.code) : [...tags, cat.code])}
              sx={{ cursor: 'pointer' }}
            />
          );
        })}
      </Box>
    );
  }

  const columns = [
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 180 },
    { field: 'type', headerName: 'Type', width: 100 },
    { field: 'unitCost', headerName: 'Unit Cost', width: 100, valueGetter: (_v: any, row: any) => row.unitCost ?? '-' },
    { field: 'unitsPerPackage', headerName: 'Units/Pack', width: 100, valueGetter: (_v: any, row: any) => row.unitsPerPackage ?? 1 },
    { field: 'active', headerName: 'Active', width: 80, valueGetter: (_v: any, row: any) => row.active !== false ? 'Yes' : 'No' },
    { field: 'bestSeller', headerName: 'Best Seller', width: 100, valueGetter: (_v: any, row: any) => row.bestSeller ? 'Yes' : 'No' },
    { field: 'promo', headerName: 'Promo', width: 80, valueGetter: (_v: any, row: any) => row.promo ? 'Yes' : 'No' },
    { field: 'avgRating', headerName: 'Rating', width: 80, valueGetter: (_v: any, row: any) => row.avgRating ? `${Number(row.avgRating).toFixed(1)} (${row.reviewCount || 0})` : '-' },
    {
      field: 'actions', headerName: 'Actions', width: 160, sortable: false, filterable: false,
      renderCell: (params: any) => (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="outlined" onClick={() => openEditModal(params.row)}>Edit</Button>
          <Button size="small" variant="outlined" color="error" onClick={() => removeProduct(params.row.id)}>Delete</Button>
        </Box>
      ),
    },
  ] as GridColDef<any>[];

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', p: { xs: 1.5, sm: 3 }, pb: 10 }}>
      {SnackbarElement}
      {ConfirmElement}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Products</Typography>
          <Typography variant="body2" color="text.secondary">{products.length} products</Typography>
        </Box>
        {!isMobile && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setIsAddOpen(true)}>
            Add Product
          </Button>
        )}
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField size="small" placeholder="Search name" value={filterName} onChange={(e) => setFilterName(e.target.value)} sx={{ minWidth: 180 }} />
        <TextField select size="small" value={filterType} onChange={(e) => setFilterType(e.target.value)} sx={{ minWidth: 120 }}>
          <MenuItem value="all">All Types</MenuItem>
          {PRODUCT_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
        </TextField>
        <Button size="small" variant="outlined" onClick={exportFilteredProducts}>Export</Button>
        <Button size="small" onClick={() => { setFilterName(''); setFilterType('all'); }}>Reset</Button>
      </Box>

      <ResponsiveDataGrid
        rows={filteredRows}
        columns={columns}
        onRowOpen={(row: any) => openEditModal(row)}
        cardTitle={(row: any) => row.name}
        cardFields={[
          { label: 'Type', value: (row: any) => row.type || '-' },
          { label: 'Unit Cost', value: (row: any) => row.unitCost ?? '-' },
          { label: 'Units/Pack', value: (row: any) => row.unitsPerPackage ?? 1 },
          { label: 'Active', value: (row: any) => row.active !== false ? 'Yes' : 'No' },
          { label: 'Best Seller', value: (row: any) => row.bestSeller ? 'Yes' : 'No' },
          { label: 'Promo', value: (row: any) => row.promo ? 'Yes' : 'No' },
          { label: 'Rating', value: (row: any) => row.avgRating ? `${Number(row.avgRating).toFixed(1)} (${row.reviewCount || 0})` : '-' },
        ]}
        cardActions={(row: any) => (
          <Button size="small" color="error" onClick={(e) => { e.stopPropagation(); removeProduct(row.id); }}>Delete</Button>
        )}
      />

      {/* Mobile FAB */}
      {isMobile && (
        <Fab color="primary" sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1200 }} onClick={() => setIsAddOpen(true)}>
          <AddIcon />
        </Fab>
      )}

      {/* ── Add Product Dialog ── */}
      <Dialog open={isAddOpen} onClose={() => { setIsAddOpen(false); resetAddForm(); }} fullScreen={isMobile} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Add New Product
          <IconButton size="small" onClick={() => { setIsAddOpen(false); resetAddForm(); }}><CloseIcon /></IconButton>
        </DialogTitle>
        <form onSubmit={createProduct}>
          <DialogContent dividers>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                <TextField
                  label="Product Name *"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  fullWidth size="small" autoFocus
                  inputProps={{ style: { textTransform: 'uppercase' } }}
                />
                <TextField select label="Type *" value={type} onChange={(e) => setType(e.target.value as any)} fullWidth size="small">
                  {PRODUCT_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                </TextField>
                <TextField
                  label="Unit Cost (GH₵)" type="number" value={unitCost || ''}
                  onChange={(e) => setUnitCost(Number(e.target.value) || 0)}
                  fullWidth size="small" inputProps={{ min: 0, step: 0.01 }}
                />
                <TextField
                  label="Units Per Package" type="number" value={unitsPerPackage || ''}
                  onChange={(e) => setUnitsPerPackage(Number(e.target.value) || 1)}
                  fullWidth size="small" inputProps={{ min: 1 }}
                />
              </Box>
              <TextField
                label="Description" value={description}
                onChange={(e) => setDescription(e.target.value)}
                fullWidth size="small" multiline rows={2}
              />
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <FormControlLabel control={<Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />} label="Active" />
                <FormControlLabel control={<Checkbox checked={bestSeller} onChange={(e) => setBestSeller(e.target.checked)} />} label="Best Seller" />
                <FormControlLabel control={<Checkbox checked={promo} onChange={(e) => setPromo(e.target.checked)} />} label="Promo" />
              </Box>
              {customerCategories.length > 0 && (
                <Box>
                  <Typography variant="caption" color="text.secondary" gutterBottom>Health Tags</Typography>
                  <HealthTagChips tags={healthTags} onChange={setHealthTags} />
                </Box>
              )}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Product Image</Typography>
                  <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)} style={{ display: 'block', marginTop: 4 }} />
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Voice Description (audio)</Typography>
                  <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} style={{ display: 'block', marginTop: 4 }} />
                </Box>
              </Box>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setIsAddOpen(false); resetAddForm(); }}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={uploading} startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : undefined}>
              {uploading ? 'Uploading...' : 'Create'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* ── Edit Product Dialog ── */}
      <Dialog open={!!editingProduct} onClose={() => setEditingProduct(null)} fullScreen={isMobile} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Edit Product
          <IconButton size="small" onClick={() => setEditingProduct(null)}><CloseIcon /></IconButton>
        </DialogTitle>
        {editingProduct && (
          <form onSubmit={saveEditedProduct}>
            <DialogContent dividers>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                  <TextField
                    label="Product Name *"
                    value={editingProduct.name || ''}
                    onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value.toUpperCase() })}
                    fullWidth size="small"
                    inputProps={{ style: { textTransform: 'uppercase' } }}
                  />
                  <TextField select label="Type *" value={editingProduct.type || 'juice'}
                    onChange={(e) => setEditingProduct({ ...editingProduct, type: e.target.value })}
                    fullWidth size="small">
                    {PRODUCT_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                  </TextField>
                  <TextField
                    label="Unit Cost (GH₵)" type="number" value={editingProduct.unitCost ?? ''}
                    onChange={(e) => setEditingProduct({ ...editingProduct, unitCost: Number(e.target.value) || 0 })}
                    fullWidth size="small" inputProps={{ min: 0, step: 0.01 }}
                  />
                  <TextField
                    label="Units Per Package" type="number" value={editingProduct.unitsPerPackage ?? 1}
                    onChange={(e) => setEditingProduct({ ...editingProduct, unitsPerPackage: Number(e.target.value) || 1 })}
                    fullWidth size="small" inputProps={{ min: 1 }}
                  />
                </Box>
                <TextField
                  label="Description" value={editingProduct.description || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })}
                  fullWidth size="small" multiline rows={2}
                />
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <FormControlLabel control={<Checkbox checked={editingProduct.active !== false} onChange={(e) => setEditingProduct({ ...editingProduct, active: e.target.checked })} />} label="Active" />
                  <FormControlLabel control={<Checkbox checked={!!editingProduct.bestSeller} onChange={(e) => setEditingProduct({ ...editingProduct, bestSeller: e.target.checked })} />} label="Best Seller" />
                  <FormControlLabel control={<Checkbox checked={!!editingProduct.promo} onChange={(e) => setEditingProduct({ ...editingProduct, promo: e.target.checked })} />} label="Promo" />
                </Box>
                {customerCategories.length > 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" gutterBottom>Health Tags</Typography>
                    <HealthTagChips
                      tags={editingProduct.healthTags || []}
                      onChange={(tags) => setEditingProduct({ ...editingProduct, healthTags: tags })}
                    />
                  </Box>
                )}
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Product Image</Typography>
                    {editingProduct.imageUrl && (
                      <Box sx={{ mb: 1, mt: 0.5 }}>
                        <img src={editingProduct.imageUrl} alt="Product" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                      </Box>
                    )}
                    <input type="file" accept="image/*" onChange={(e) => setEditImageFile(e.target.files?.[0] || null)} style={{ display: 'block', marginTop: 4 }} />
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Voice Description (audio)</Typography>
                    {editingProduct.audioUrl && (
                      <Box sx={{ mb: 1, mt: 0.5 }}>
                        <audio controls src={editingProduct.audioUrl} style={{ width: '100%', maxWidth: 180 }} />
                      </Box>
                    )}
                    <input type="file" accept="audio/*" onChange={(e) => setEditAudioFile(e.target.files?.[0] || null)} style={{ display: 'block', marginTop: 4 }} />
                  </Box>
                </Box>
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditingProduct(null)}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={uploading} startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : undefined}>
                {uploading ? 'Uploading...' : 'Save'}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>
    </Box>
  );
}
