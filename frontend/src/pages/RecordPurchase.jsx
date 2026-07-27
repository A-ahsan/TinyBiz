import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import SearchableSelect from '../components/SearchableSelect';
import './Page.css';
import './RecordPurchase.css';

const emptyLine = () => ({ product_id: '', quantity: '', buying_rate: '' });

const round2 = (value) => Number(Number(value).toFixed(2));

// One amount is paid for the whole purchase, but each line stays its own costing
// batch, so the paid amount is spread across lines in proportion to their cost.
// The last line absorbs the rounding remainder so the parts always sum exactly
// to what the user typed — otherwise seller balances would drift by a paisa.
const splitAmountPaid = (lineTotals, amountPaid) => {
  const paid = round2(amountPaid || 0);
  if (paid <= 0) return lineTotals.map(() => 0);

  const grandTotal = lineTotals.reduce((sum, total) => sum + total, 0);
  if (grandTotal <= 0) {
    return lineTotals.map((_, index) => (index === 0 ? paid : 0));
  }

  const shares = lineTotals.map(total => round2((total / grandTotal) * paid));
  const allocated = shares.slice(0, -1).reduce((sum, share) => sum + share, 0);
  shares[shares.length - 1] = round2(paid - allocated);
  return shares;
};

// True when the database has not had migration 002 applied yet.
const isMissingGroupColumn = (err) => {
  const message = `${err?.message || ''}`.toLowerCase();
  return err?.code === '42703'
    || err?.code === 'PGRST204'
    || message.includes('purchase_group_id')
    || message.includes('purchase_number');
};

const newGroupId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : null
);

const RecordPurchase = () => {
  const { user } = useAuth();
  const [sellers, setSellers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [amountPaid, setAmountPaid] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [showAddSeller, setShowAddSeller] = useState(false);
  const [newSeller, setNewSeller] = useState({ name: '', store_name: '' });

  useEffect(() => {
    if (user) loadPickers();
  }, [user]);

  const loadPickers = async () => {
    setLoading(true);
    try {
      const [{ data: sellersData, error: sellersErr }, { data: productsData, error: productsErr }] = await Promise.all([
        supabase.from('sellers').select('*').eq('user_id', user.id).eq('status', 'active').order('name'),
        supabase.from('products').select('*').eq('user_id', user.id).eq('status', 'active').order('name'),
      ]);

      if (sellersErr) throw sellersErr;
      if (productsErr) throw productsErr;

      setSellers(sellersData || []);
      setProducts(productsData || []);
    } catch (err) {
      console.error(err);
      setError('Failed to load sellers or products');
    } finally {
      setLoading(false);
    }
  };

  const handleNewSellerChange = (e) => {
    const { name, value } = e.target;
    setNewSeller(prev => ({ ...prev, [name]: value }));
  };

  const addSeller = async () => {
    if (!newSeller.name.trim()) return setError('Seller name is required');
    try {
      setSubmitting(true);
      const payload = {
        user_id: user.id,
        name: newSeller.name.trim(),
        store_name: newSeller.store_name.trim() || null,
      };
      const { data, error: insErr } = await supabase.from('sellers').insert([payload]).select().single();
      if (insErr) throw insErr;
      await loadPickers();
      setSellerId(data.id);
      setShowAddSeller(false);
      setNewSeller({ name: '', store_name: '' });
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to add seller');
    } finally {
      setSubmitting(false);
    }
  };

  const updateLine = (idx, patch) => {
    setLines(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...patch };
      return copy;
    });
  };

  const addLine = () => setLines(prev => [...prev, emptyLine()]);
  const removeLine = (i) => setLines(prev => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const handleProductChange = (idx, productId) => {
    updateLine(idx, { product_id: productId });
  };

  const resetForm = () => {
    setSellerId('');
    setDate(new Date().toISOString().split('T')[0]);
    setAmountPaid('');
    setLines([emptyLine()]);
  };

  const computeTotals = () => lines.reduce((total, line) => {
    const quantity = Number(line.quantity || 0);
    const rate = Number(line.buying_rate || 0);
    return total + quantity * rate;
  }, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!sellerId) return setError('Please select a seller');

    const cleanedLines = lines.map(line => ({
      product_id: line.product_id,
      quantity: Number(line.quantity),
      buying_rate: Number(line.buying_rate),
    }));

    for (let i = 0; i < cleanedLines.length; i += 1) {
      const line = cleanedLines[i];
      if (!line.product_id) return setError(`Line ${i + 1}: please select a product`);
      if (Number.isNaN(line.quantity) || line.quantity <= 0) {
        return setError(`Line ${i + 1}: quantity must be greater than zero`);
      }
      if (Number.isNaN(line.buying_rate) || line.buying_rate < 0) {
        return setError(`Line ${i + 1}: buying rate must be zero or greater`);
      }
    }

    const amountPaidValue = amountPaid ? Number(amountPaid) : 0;
    if (Number.isNaN(amountPaidValue) || amountPaidValue < 0) {
      return setError('Amount paid cannot be negative');
    }

    const lineTotals = cleanedLines.map(line => round2(line.quantity * line.buying_rate));
    const paidShares = splitAmountPaid(lineTotals, amountPaidValue);
    const groupId = newGroupId();
    const purchaseNumber = `PUR-${Date.now()}`;

    try {
      setSubmitting(true);

      const payload = cleanedLines.map((line, index) => {
        const qty = Number(line.quantity.toFixed(3));
        return {
          user_id: user.id,
          seller_id: sellerId,
          product_id: line.product_id,
          date,
          quantity: qty,
          buying_rate: round2(line.buying_rate),
          amount_paid: paidShares[index],
          remaining_qty: qty,
          ...(groupId ? { purchase_group_id: groupId, purchase_number: purchaseNumber } : {}),
        };
      });

      let { error: insertErr } = await supabase.from('purchases').insert(payload);

      // Fall back gracefully if migration 002 has not been applied yet — the
      // purchase still records correctly, it just is not grouped in reports.
      if (insertErr && isMissingGroupColumn(insertErr)) {
        const legacyPayload = payload.map(({ purchase_group_id: _g, purchase_number: _n, ...rest }) => rest);
        ({ error: insertErr } = await supabase.from('purchases').insert(legacyPayload));
      }

      if (insertErr) throw insertErr;

      setSuccess(
        `Purchase recorded — ${payload.length} item${payload.length > 1 ? 's' : ''}, total BDT ${computeTotals().toFixed(2)}`,
      );
      resetForm();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to record purchase');
    } finally {
      setSubmitting(false);
    }
  };

  const totalCost = computeTotals();
  const amtPaid = Number(amountPaid || 0);
  const balance = totalCost - amtPaid;

  if (loading) {
    return (
      <div className="page-container">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Record Purchase</h1>
          <p>Record one purchase from a seller — add as many products as you need.</p>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <form className="purchase-form card" onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label>Seller *</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <div style={{ flex: 1 }}>
                <SearchableSelect
                  value={sellerId}
                  onChange={setSellerId}
                  placeholder="Select seller"
                  emptyText="No seller matches"
                  options={sellers.map(s => ({
                    value: s.id,
                    label: s.store_name ? `${s.name} • ${s.store_name}` : s.name,
                  }))}
                />
              </div>
              <button type="button" className="btn-secondary" onClick={() => setShowAddSeller(v => !v)}>{showAddSeller ? 'Cancel' : 'Add'}</button>
            </div>

            {showAddSeller && (
              <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                <input name="name" placeholder="Name *" value={newSeller.name} onChange={handleNewSellerChange} />
                <input name="store_name" placeholder="Store name (optional)" value={newSeller.store_name} onChange={handleNewSellerChange} />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" className="btn-primary" onClick={addSeller} disabled={submitting}>Create Seller</button>
                  <button type="button" className="btn-secondary" onClick={() => setShowAddSeller(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Date *</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
          </div>
        </div>

        <div style={{ marginTop: '1rem' }}>
          <h3>Line Items</h3>
          {lines.map((line, idx) => (
            <div className="form-row" key={idx} style={{ alignItems: 'end' }}>
              <div className="form-group">
                <label>Product</label>
                <SearchableSelect
                  value={line.product_id}
                  onChange={(productId) => handleProductChange(idx, productId)}
                  placeholder="Select product"
                  emptyText="No product matches"
                  options={products.map(p => ({ value: p.id, label: p.name }))}
                />
              </div>
              <div className="form-group">
                <label>Quantity</label>
                <input type="number" step="0.001" min="0.001" value={line.quantity} onChange={e => updateLine(idx, { quantity: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Buying Rate</label>
                <input type="number" step="0.01" min="0" value={line.buying_rate} onChange={e => updateLine(idx, { buying_rate: e.target.value })} required />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn-secondary" onClick={() => removeLine(idx)} disabled={lines.length === 1}>Remove</button>
              </div>
            </div>
          ))}
          <div style={{ marginTop: '0.5rem' }}>
            <button type="button" className="btn-secondary" onClick={addLine}>Add Line</button>
          </div>
          <p className="small-note">Each line becomes its own costing batch for FIFO, but they are saved together as one purchase.</p>
        </div>

        <div style={{ marginTop: '1rem' }}>
          <div className="form-row">
            <div className="form-group">
              <label>Total Cost</label>
              <div style={{ padding: '0.5rem 0' }}>BDT {totalCost.toFixed(2)}</div>
            </div>
            <div className="form-group">
              <label>Amount Paid</label>
              <input type="number" step="0.01" min="0" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Balance</label>
              <div style={{ padding: '0.5rem 0' }}>{balance >= 0 ? `Due BDT ${balance.toFixed(2)}` : `Advance BDT ${Math.abs(balance).toFixed(2)}`}</div>
            </div>
          </div>
        </div>

        <div className="form-actions" style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
          <button type="button" onClick={resetForm} className="btn-secondary">Reset</button>
          <button type="submit" className="btn-primary" disabled={submitting}>Record Purchase</button>
        </div>
      </form>
    </div>
  );
};

export default RecordPurchase;
