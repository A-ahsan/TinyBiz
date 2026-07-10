import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import './Page.css';
import './RecordPurchase.css';

const emptyLine = { product_id: '', quantity: '', buying_rate: '', amount_paid: '' };

const RecordPurchase = () => {
  const { user } = useAuth();
  const [sellers, setSellers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    seller_id: '',
    date: new Date().toISOString().split('T')[0],
  });
  const [lines, setLines] = useState([{ ...emptyLine }]);
  const [showAddSeller, setShowAddSeller] = useState(false);
  const [newSeller, setNewSeller] = useState({ name: '', store_name: '' });

  useEffect(() => {
    if (user) loadPickers();
  }, [user]);

  const loadPickers = async () => {
    setLoading(true);
    try {
      const [{ data: sellersData }, { data: productsData }] = await Promise.all([
        supabase.from('sellers').select('*').eq('user_id', user.id).eq('status', 'active').order('name'),
        supabase.from('products').select('*').eq('user_id', user.id).eq('status', 'active').order('name'),
      ]);

      setSellers(sellersData || []);
      setProducts(productsData || []);
    } catch (err) {
      console.error(err);
      setError('Failed to load sellers or products');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setForm({ seller_id: '', date: new Date().toISOString().split('T')[0] });
    setLines([{ ...emptyLine }]);
  };

  const handleLineChange = (index, field, value) => {
    setLines(prev => prev.map((line, i) => (i === index ? { ...line, [field]: value } : line)));
  };

  const addLine = () => {
    setLines(prev => [...prev, { ...emptyLine }]);
  };

  const removeLine = (index) => {
    setLines(prev => {
      if (prev.length === 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleNewSellerChange = (e) => {
    const { name, value } = e.target;
    setNewSeller(prev => ({ ...prev, [name]: value }));
  };

  const addSeller = async () => {
    if (!newSeller.name) return setError('Seller name is required');
    try {
      setLoading(true);
      const payload = { user_id: user.id, name: newSeller.name, store_name: newSeller.store_name };
      const { data, error: insErr } = await supabase.from('sellers').insert([payload]).select().single();
      if (insErr) throw insErr;
      // reload pickers and set selected seller
      await loadPickers();
      setForm(prev => ({ ...prev, seller_id: data.id }));
      setShowAddSeller(false);
      setNewSeller({ name: '', store_name: '' });
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to add seller');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validation
    if (!form.seller_id) return setError('Please select a seller');

    const cleanedLines = lines
      .map((line) => ({
        product_id: line.product_id,
        quantity: line.quantity === '' ? '' : Number(line.quantity),
        buying_rate: line.buying_rate === '' ? '' : Number(line.buying_rate),
        amount_paid: line.amount_paid === '' ? 0 : Number(line.amount_paid),
      }))
      .filter((line) => line.product_id || line.quantity !== '' || line.buying_rate !== '' || line.amount_paid !== 0);

    if (cleanedLines.length === 0) return setError('Add at least one item');

    for (let i = 0; i < cleanedLines.length; i += 1) {
      const line = cleanedLines[i];
      if (!line.product_id) return setError(`Line ${i + 1}: please select a product`);
      if (line.quantity === '' || Number.isNaN(line.quantity) || line.quantity <= 0) {
        return setError(`Line ${i + 1}: quantity must be greater than zero`);
      }
      if (line.buying_rate === '' || Number.isNaN(line.buying_rate) || line.buying_rate < 0) {
        return setError(`Line ${i + 1}: buying rate must be zero or greater`);
      }
      if (Number.isNaN(line.amount_paid) || line.amount_paid < 0) {
        return setError(`Line ${i + 1}: amount paid cannot be negative`);
      }
    }

    try {
      const payload = cleanedLines.map((line) => {
        const qty = Number(parseFloat(line.quantity).toFixed(3));
        return {
          user_id: user.id,
          seller_id: form.seller_id,
          product_id: line.product_id,
          date: form.date,
          quantity: qty,
          buying_rate: Number(parseFloat(line.buying_rate).toFixed(2)),
          amount_paid: Number(parseFloat(line.amount_paid || 0).toFixed(2)),
          remaining_qty: qty,
        };
      });

      const { error: insertErr } = await supabase.from('purchases').insert(payload);
      if (insertErr) throw insertErr;

      setSuccess(`${payload.length} purchase item${payload.length > 1 ? 's' : ''} recorded successfully`);
      resetForm();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to record purchase');
    }
  };

  if (loading) return (<div className="page-container"><div className="spinner"></div></div>);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Record Purchase</h1>
          <p>Record one or more purchase items from a single seller.</p>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <form className="purchase-form card" onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label>Seller *</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select name="seller_id" value={form.seller_id} onChange={handleChange} required style={{ flex: 1 }}>
                <option value="">Select seller</option>
                {sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" className="btn-secondary" onClick={() => setShowAddSeller(v => !v)}>{showAddSeller ? 'Cancel' : 'Add'}</button>
            </div>

            {showAddSeller && (
              <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                <input name="name" placeholder="Name *" value={newSeller.name} onChange={handleNewSellerChange} />
                <input name="store_name" placeholder="Store name (optional)" value={newSeller.store_name} onChange={handleNewSellerChange} />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" className="btn-primary" onClick={addSeller}>Create Seller</button>
                  <button type="button" className="btn-secondary" onClick={() => setShowAddSeller(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>

        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Date *</label>
            <input type="date" name="date" value={form.date} onChange={handleChange} required />
          </div>
        </div>

        <div className="purchase-lines">
          {lines.map((line, index) => (
            <div className="purchase-line" key={`line-${index}`}>
              <div className="form-group">
                <label>Product *</label>
                <select
                  value={line.product_id}
                  onChange={(e) => handleLineChange(index, 'product_id', e.target.value)}
                  required
                >
                  <option value="">Select product</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label>Quantity *</label>
                <input
                  type="number"
                  value={line.quantity}
                  onChange={(e) => handleLineChange(index, 'quantity', e.target.value)}
                  required
                  step="0.001"
                  min="0.001"
                />
              </div>

              <div className="form-group">
                <label>Buying Rate (BDT) *</label>
                <input
                  type="number"
                  value={line.buying_rate}
                  onChange={(e) => handleLineChange(index, 'buying_rate', e.target.value)}
                  required
                  step="0.01"
                  min="0"
                />
              </div>

              <div className="form-group">
                <label>Amount Paid</label>
                <input
                  type="number"
                  value={line.amount_paid}
                  onChange={(e) => handleLineChange(index, 'amount_paid', e.target.value)}
                  step="0.01"
                  min="0"
                />
              </div>

              <div className="line-actions">
                <button type="button" className="btn-secondary" onClick={() => removeLine(index)} disabled={lines.length === 1}>Remove</button>
              </div>
            </div>
          ))}

          <button type="button" className="btn-secondary" onClick={addLine}>+ Add Item</button>
          <p className="small-note">Each item creates its own purchase batch while keeping the same seller and date.</p>
        </div>

        <div className="form-actions" style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
          <button type="button" onClick={resetForm} className="btn-secondary">Reset</button>
          <button type="submit" className="btn-primary">Record Purchase Items</button>
        </div>
      </form>
    </div>
  );
};

export default RecordPurchase;
