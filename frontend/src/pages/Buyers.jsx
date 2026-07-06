import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Trash2, Edit2, Plus, X } from 'lucide-react';
import { formatCurrency } from '../utils/helpers';
import './Directory.css';

const Buyers = () => {
  const { user } = useAuth();
  const [buyers, setBuyers] = useState([]);
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
      const { data: buyersData, error: err1 } = await supabase
        .from('buyers')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (err1) throw err1;
      const { data: balancesData, error: err2 } = await supabase
        .from('buyer_balances')
        .select('*')
        .eq('user_id', user.id);
      if (err2) throw err2;
      setBuyers(buyersData || []);
      const balanceMap = {};
      if (balancesData) balancesData.forEach(b => balanceMap[b.buyer_id] = b.running_balance);
      setBalances(balanceMap);
    } catch (err) {
      setError(err.message || 'Failed to fetch buyers');
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
      setError('Buyer name is required');
      return;
    }
    try {
      if (editingId) {
        const { error: err } = await supabase
          .from('buyers')
          .update(formData)
          .eq('id', editingId)
          .eq('user_id', user.id);
        if (err) throw err;
        setSuccess('Buyer updated successfully');
      } else {
        const { error: err } = await supabase
          .from('buyers')
          .insert({ ...formData, user_id: user.id });
        if (err) throw err;
        setSuccess('Buyer added successfully');
      }
      resetForm();
      await fetchData();
    } catch (err) {
      setError(err.message || 'Operation failed');
    }
  };

  const handleEdit = (buyer) => {
    setFormData({
      name: buyer.name,
      store_name: buyer.store_name || '',
      location: buyer.location || '',
      email: buyer.email || '',
      phone: buyer.phone || '',
    });
    setEditingId(buyer.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this buyer? (Data preserved in records)')) return;
    try {
      setError('');
      const { error: err } = await supabase
        .from('buyers')
        .update({ status: 'removed' })
        .eq('id', id)
        .eq('user_id', user.id);
      if (err) throw err;
      setSuccess('Buyer removed');
      await fetchData();
    } catch (err) {
      setError(err.message || 'Failed to remove buyer');
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

  const filteredBuyers = buyers.filter(b =>
    b.status === 'active' && (b.name.toLowerCase().includes(searchTerm.toLowerCase()) || b.store_name?.toLowerCase().includes(searchTerm.toLowerCase()))
  );
  const activeBuyers = buyers.filter(b => b.status === 'active').length;
  const removedBuyers = buyers.filter(b => b.status === 'removed').length;

  if (loading) return <div className="page-container"><div className="spinner"></div></div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div><h1>Buyers</h1><p>Manage your customer relationships.</p></div>
        <button className="btn-primary btn-with-icon" onClick={() => setShowForm(true)}>
          <Plus size={18} /> Add Buyer
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      <div className="stats-row">
        <div className="stat-card"><span className="stat-label">Total Buyers</span><span className="stat-value">{buyers.length}</span></div>
        <div className="stat-card"><span className="stat-label">Active</span><span className="stat-value">{activeBuyers}</span></div>
        <div className="stat-card"><span className="stat-label">Removed</span><span className="stat-value">{removedBuyers}</span></div>
      </div>
      <div className="directory-header">
        <h3>All Buyers ({filteredBuyers.length})</h3>
        <input type="text" placeholder="Search buyers..." className="search-input" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
      </div>
      {filteredBuyers.length === 0 ? (
        <div className="empty-state">
          <p>No buyers found</p>
          <button className="btn-primary" onClick={() => setShowForm(true)}>Add your first buyer</button>
        </div>
      ) : (
        <div className="directory-table">
          <table>
            <thead><tr><th>Name</th><th>Store</th><th>Contact</th><th>Balance</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredBuyers.map(buyer => {
                const balance = balances[buyer.id] || 0;
                const { label, amount, type } = getBalanceLabel(balance);
                return (
                  <tr key={buyer.id}>
                    <td className="name-cell">{buyer.name}</td>
                    <td>{buyer.store_name || '-'}</td>
                    <td className="contact-cell">{buyer.email || buyer.phone || '-'}</td>
                    <td><span className={`balance-badge ${type}`}>{label} {formatCurrency(amount)}</span></td>
                    <td className="actions-cell">
                      <button className="action-btn edit" onClick={() => handleEdit(buyer)} title="Edit"><Edit2 size={16} /></button>
                      <button className="action-btn delete" onClick={() => handleDelete(buyer.id)} title="Remove"><Trash2 size={16} /></button>
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
              <h2>{editingId ? 'Edit Buyer' : 'Add New Buyer'}</h2>
              <button className="modal-close" onClick={resetForm}><X size={24} /></button>
            </div>
            <form onSubmit={handleSubmit} className="buyer-form">
              <div className="form-group"><label>Name *</label><input type="text" name="name" value={formData.name} onChange={handleInputChange} placeholder="Buyer name" required /></div>
              <div className="form-group"><label>Store Name</label><input type="text" name="store_name" value={formData.store_name} onChange={handleInputChange} placeholder="Store/company name" /></div>
              <div className="form-row">
                <div className="form-group"><label>Email</label><input type="email" name="email" value={formData.email} onChange={handleInputChange} placeholder="Email address" /></div>
                <div className="form-group"><label>Phone</label><input type="text" name="phone" value={formData.phone} onChange={handleInputChange} placeholder="Phone number" /></div>
              </div>
              <div className="form-group"><label>Location</label><input type="text" name="location" value={formData.location} onChange={handleInputChange} placeholder="Address or location" /></div>
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={resetForm}>Cancel</button>
                <button type="submit" className="btn-primary">{editingId ? 'Update Buyer' : 'Add Buyer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Buyers;
