import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Trash2, Edit2, Plus, X } from 'lucide-react';
import { formatCurrency } from '../utils/helpers';
import './Directory.css';

const Sellers = () => {
  const { user } = useAuth();
  const [sellers, setSellers] = useState([]);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    store_name: '',
    location: '',
    email: '',
    phone: '',
  });

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const { data: sellersData, error: err1 } = await supabase
        .from('sellers')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (err1) throw err1;
      const { data: balancesData, error: err2 } = await supabase
        .from('seller_balances')
        .select('*')
        .eq('user_id', user.id);
      if (err2) throw err2;
      setSellers(sellersData || []);
      const balanceMap = {};
      if (balancesData) balancesData.forEach(b => balanceMap[b.seller_id] = b.running_balance);
      setBalances(balanceMap);
    } catch (err) {
      setError(err.message || 'Failed to fetch sellers');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!formData.name.trim()) {
      setError('Seller name is required');
      return;
    }
    try {
      // Blank optional fields belong in the database as NULL, not '' — an empty
      // string is a value, and it defeats every "is this set?" check.
      const payload = {
        name: formData.name.trim(),
        store_name: formData.store_name.trim() || null,
        location: formData.location.trim() || null,
        email: formData.email.trim() || null,
        phone: formData.phone.trim() || null,
      };

      if (editingId) {
        const { error: err } = await supabase
          .from('sellers')
          .update(payload)
          .eq('id', editingId)
          .eq('user_id', user.id);
        if (err) throw err;
        setSuccess('Seller updated successfully');
      } else {
        const { error: err } = await supabase
          .from('sellers')
          .insert({ ...payload, user_id: user.id });
        if (err) throw err;
        setSuccess('Seller added successfully');
      }
      resetForm();
      await fetchData();
    } catch (err) {
      setError(err.message || 'Operation failed');
    }
  };

  const handleEdit = (seller) => {
    setFormData({
      name: seller.name,
      store_name: seller.store_name || '',
      location: seller.location || '',
      email: seller.email || '',
      phone: seller.phone || '',
    });
    setEditingId(seller.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this seller? (Data preserved in records)')) return;
    try {
      setError('');
      const { error: err } = await supabase
        .from('sellers')
        .update({ status: 'removed' })
        .eq('id', id)
        .eq('user_id', user.id);
      if (err) throw err;
      setSuccess('Seller removed');
      await fetchData();
    } catch (err) {
      setError(err.message || 'Failed to remove seller');
    }
  };

  const resetForm = () => {
    setFormData({ name: '', store_name: '', location: '', email: '', phone: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const getBalanceLabel = (balance) => {
    if (!balance) return { label: 'Settled', amount: 0, type: 'settled' };
    if (balance > 0) return { label: 'Due', amount: balance, type: 'due' };
    return { label: 'Advance', amount: Math.abs(balance), type: 'advance' };
  };

  const filteredSellers = sellers.filter(s =>
    s.status === 'active' && (s.name.toLowerCase().includes(searchTerm.toLowerCase()) || s.store_name?.toLowerCase().includes(searchTerm.toLowerCase()))
  );
  const activeSellers = sellers.filter(s => s.status === 'active').length;
  const removedSellers = sellers.filter(s => s.status === 'removed').length;

  if (loading) return <div className="page-container"><div className="spinner"></div></div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div><h1>Sellers</h1><p>Manage your supplier relationships.</p></div>
        <button className="btn-primary btn-with-icon" onClick={() => setShowForm(true)}>
          <Plus size={18} /> Add Seller
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      <div className="stats-row">
        <div className="stat-card"><span className="stat-label">Total Sellers</span><span className="stat-value">{sellers.length}</span></div>
        <div className="stat-card"><span className="stat-label">Active</span><span className="stat-value">{activeSellers}</span></div>
        <div className="stat-card"><span className="stat-label">Removed</span><span className="stat-value">{removedSellers}</span></div>
      </div>
      <div className="directory-header">
        <h3>All Sellers ({filteredSellers.length})</h3>
        <input type="text" placeholder="Search sellers..." className="search-input" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
      </div>
      {filteredSellers.length === 0 ? (
        <div className="empty-state">
          <p>No sellers found</p>
          <button className="btn-primary" onClick={() => setShowForm(true)}>Add your first seller</button>
        </div>
      ) : (
        <div className="directory-table">
          <table>
            <thead><tr><th>Name</th><th>Store</th><th>Contact</th><th>Balance</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredSellers.map(seller => {
                const balance = balances[seller.id] || 0;
                const { label, amount, type } = getBalanceLabel(balance);
                return (
                  <tr key={seller.id}>
                    <td className="name-cell">{seller.name}</td>
                    <td>{seller.store_name || '-'}</td>
                    <td className="contact-cell">{seller.email || seller.phone || '-'}</td>
                    <td><span className={`balance-badge ${type}`}>{label} {formatCurrency(amount)}</span></td>
                    <td className="actions-cell">
                      <button className="action-btn edit" onClick={() => handleEdit(seller)} title="Edit"><Edit2 size={16} /></button>
                      <button className="action-btn delete" onClick={() => handleDelete(seller.id)} title="Remove"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {showForm && (
        <div className="modal-overlay" onClick={() => !editingId && resetForm()}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit Seller' : 'Add New Seller'}</h2>
              <button className="modal-close" onClick={resetForm}><X size={24} /></button>
            </div>
            <form onSubmit={handleSubmit} className="seller-form">
              <div className="form-group"><label>Name *</label><input type="text" name="name" value={formData.name} onChange={handleInputChange} placeholder="Seller name" required /></div>
              <div className="form-group"><label>Store Name</label><input type="text" name="store_name" value={formData.store_name} onChange={handleInputChange} placeholder="Store/company name" /></div>
              <div className="form-row">
                <div className="form-group"><label>Email</label><input type="email" name="email" value={formData.email} onChange={handleInputChange} placeholder="Email address" /></div>
                <div className="form-group"><label>Phone</label><input type="text" name="phone" value={formData.phone} onChange={handleInputChange} placeholder="Phone number" /></div>
              </div>
              <div className="form-group"><label>Location</label><input type="text" name="location" value={formData.location} onChange={handleInputChange} placeholder="Address or location" /></div>
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={resetForm}>Cancel</button>
                <button type="submit" className="btn-primary">{editingId ? 'Update Seller' : 'Add Seller'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Sellers;
