import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import './Page.css';
import './RecordPurchase.css';

const RecordPurchase = () => {
  const { user } = useAuth();
  const [sellers, setSellers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    seller_id: '',
    product_id: '',
    date: new Date().toISOString().split('T')[0],
    quantity: '',
    buying_rate: '',
    amount_paid: '',
  });
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

  const resetForm = () => setForm({ seller_id: '', product_id: '', date: new Date().toISOString().split('T')[0], quantity: '', buying_rate: '', amount_paid: '' });

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
    if (!form.product_id) return setError('Please select a product');
    if (!form.quantity || Number(form.quantity) <= 0) return setError('Quantity must be greater than zero');
    if (form.buying_rate === '' || Number(form.buying_rate) < 0) return setError('Buying rate must be zero or greater');

    try {
      const payload = {
        user_id: user.id,
        seller_id: form.seller_id,
        product_id: form.product_id,
        date: form.date,
        quantity: Number(parseFloat(form.quantity).toFixed(3)),
        buying_rate: Number(parseFloat(form.buying_rate).toFixed(2)),
        amount_paid: form.amount_paid ? Number(parseFloat(form.amount_paid).toFixed(2)) : 0,
        remaining_qty: Number(parseFloat(form.quantity).toFixed(3)),
      };

      const { error: insertErr } = await supabase.from('purchases').insert([payload]);
      if (insertErr) throw insertErr;

      setSuccess('Purchase recorded successfully');
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
          <p>Record a new purchase batch from a seller.</p>
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

          <div className="form-group">
            <label>Product *</label>
            <select name="product_id" value={form.product_id} onChange={handleChange} required>
              <option value="">Select product</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Date *</label>
            <input type="date" name="date" value={form.date} onChange={handleChange} required />
          </div>

          <div className="form-group">
            <label>Quantity *</label>
            <input type="number" name="quantity" value={form.quantity} onChange={handleChange} required step="0.001" min="0.001" />
          </div>

          <div className="form-group">
            <label>Buying Rate (BDT) *</label>
            <input type="number" name="buying_rate" value={form.buying_rate} onChange={handleChange} required step="0.01" min="0" />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Amount Paid</label>
            <input type="number" name="amount_paid" value={form.amount_paid} onChange={handleChange} step="0.01" min="0" />
            <p className="small-note">Enter amount paid now. Remaining will be a due or advance.</p>
          </div>
        </div>

        <div className="form-actions" style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
          <button type="button" onClick={resetForm} className="btn-secondary">Reset</button>
          <button type="submit" className="btn-primary">Record Purchase</button>
        </div>
      </form>
    </div>
  );
};

export default RecordPurchase;
