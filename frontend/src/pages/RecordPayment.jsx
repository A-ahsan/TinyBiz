import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { formatCurrency } from '../utils/helpers';
import { Plus } from 'lucide-react';
import './RecordPayment.css';

const RecordPayment = () => {
  const { user } = useAuth();
  const [partyType, setPartyType] = useState('seller');
  const [parties, setParties] = useState([]);
  const [linkedTransactions, setLinkedTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formData, setFormData] = useState({
    partyId: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    paymentType: 'settlement',
    linkedId: '',
  });

  useEffect(() => {
    if (user) {
      loadParties();
    }
  }, [user, partyType]);

  useEffect(() => {
    if (user && formData.partyId) {
      loadLinkedTransactions();
    } else {
      setLinkedTransactions([]);
      setFormData(prev => ({ ...prev, linkedId: '' }));
    }
  }, [user, formData.partyId, partyType]);

  const loadParties = async () => {
    try {
      setLoading(true);
      setError('');
      const table = partyType === 'seller' ? 'sellers' : 'buyers';
      const { data, error: err } = await supabase
        .from(table)
        .select('id, name, store_name, status')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('name', { ascending: true });

      if (err) throw err;
      setParties(data || []);
    } catch (err) {
      setError(err.message || 'Failed to load parties');
    } finally {
      setLoading(false);
    }
  };

  const loadLinkedTransactions = async () => {
    try {
      const table = partyType === 'seller' ? 'purchases' : 'sales';
      const foreignKey = partyType === 'seller' ? 'seller_id' : 'buyer_id';
      const selectFields = partyType === 'seller'
        ? 'id, date, total_cost, amount_paid'
        : 'id, date, invoice_number, amount_received';

      const { data, error: err } = await supabase
        .from(table)
        .select(selectFields)
        .eq('user_id', user.id)
        .eq(foreignKey, formData.partyId)
        .eq('status', 'active')
        .order('date', { ascending: false })
        .limit(20);

      if (err) throw err;
      setLinkedTransactions(data || []);
    } catch (err) {
      setError(err.message || 'Failed to load linked transactions');
      setLinkedTransactions([]);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handlePartyTypeChange = (value) => {
    setPartyType(value);
    setFormData({
      partyId: '',
      amount: '',
      date: new Date().toISOString().slice(0, 10),
      paymentType: 'settlement',
      linkedId: '',
    });
    setLinkedTransactions([]);
    setSuccess('');
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!formData.partyId) {
      setError('Please select a party');
      return;
    }

    const amount = Number(formData.amount);
    if (!amount || amount <= 0) {
      setError('Enter a valid payment amount');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        user_id: user.id,
        direction: partyType === 'seller' ? 'to_seller' : 'from_buyer',
        party_type: partyType,
        party_id: formData.partyId,
        amount,
        payment_type: formData.paymentType,
        date: formData.date,
        linked_purchase_id: null,
        linked_sale_id: null,
      };

      if (formData.linkedId) {
        if (partyType === 'seller') {
          payload.linked_purchase_id = formData.linkedId;
        } else {
          payload.linked_sale_id = formData.linkedId;
        }
      }

      const { error: err } = await supabase.from('payments').insert(payload);
      if (err) throw err;

      setSuccess('Payment recorded successfully');
      setFormData(prev => ({
        ...prev,
        partyId: '',
        amount: '',
        linkedId: '',
      }));
      setLinkedTransactions([]);
    } catch (err) {
      setError(err.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  const selectedParty = parties.find(p => p.id === formData.partyId);

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
          <h1>Record Payment</h1>
          <p>Clear dues or log advances for sellers and buyers.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="payment-shell">
        <form className="payment-form" onSubmit={handleSubmit}>
          <div className="payment-switch">
            <button
              type="button"
              className={`switch-btn ${partyType === 'seller' ? 'active' : ''}`}
              onClick={() => handlePartyTypeChange('seller')}
            >
              Pay Seller
            </button>
            <button
              type="button"
              className={`switch-btn ${partyType === 'buyer' ? 'active' : ''}`}
              onClick={() => handlePartyTypeChange('buyer')}
            >
              Receive from Buyer
            </button>
          </div>

          <div className="form-group">
            <label>{partyType === 'seller' ? 'Seller *' : 'Buyer *'}</label>
            <select name="partyId" value={formData.partyId} onChange={handleChange} required>
              <option value="">Select {partyType}</option>
              {parties.map(party => (
                <option key={party.id} value={party.id}>
                  {party.name}{party.store_name ? ` • ${party.store_name}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Date *</label>
              <input type="date" name="date" value={formData.date} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label>Amount *</label>
              <input type="number" name="amount" value={formData.amount} onChange={handleChange} min="0" step="0.01" placeholder="0.00" required />
            </div>
          </div>

          <div className="form-group">
            <label>Payment Type *</label>
            <select name="paymentType" value={formData.paymentType} onChange={handleChange} required>
              <option value="settlement">Settlement</option>
              <option value="advance">Advance</option>
              <option value="due_clearance">Due Clearance</option>
            </select>
          </div>

          <div className="form-group">
            <label>Optional Link to Past Transaction</label>
            <select name="linkedId" value={formData.linkedId} onChange={handleChange}>
              <option value="">None</option>
              {linkedTransactions.map(tx => (
                <option key={tx.id} value={tx.id}>
                  {partyType === 'seller'
                    ? `${tx.date} • Purchase • ${formatCurrency(tx.total_cost || 0)} total`
                    : `${tx.date} • Invoice ${tx.invoice_number || tx.id.slice(0, 8)} • ${formatCurrency(tx.amount_received || 0)} received`}
                </option>
              ))}
            </select>
          </div>

          {selectedParty && (
            <div className="payment-summary">
              <p>
                Recording payment for <strong>{selectedParty.name}</strong>
                {selectedParty.store_name ? ` (${selectedParty.store_name})` : ''}.
              </p>
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setFormData({ partyId: '', amount: '', date: new Date().toISOString().slice(0, 10), paymentType: 'settlement', linkedId: '' })}>
              Reset
            </button>
            <button type="submit" className="btn-primary btn-with-icon" disabled={saving}>
              <Plus size={18} />
              {saving ? 'Saving...' : 'Save Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RecordPayment;
