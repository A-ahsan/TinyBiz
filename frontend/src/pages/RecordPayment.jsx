import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { formatCurrency } from '../utils/helpers';
import SearchableSelect from '../components/SearchableSelect';
import { Plus } from 'lucide-react';
import './RecordPayment.css';

const formatBalanceLabel = (balance) => {
  const value = Number(balance || 0);
  if (value === 0) return { label: 'Settled', amount: 0, className: 'settled' };
  if (value > 0) return { label: 'Due', amount: value, className: 'due' };
  return { label: 'Advance', amount: Math.abs(value), className: 'advance' };
};

const RecordPayment = () => {
  const { user } = useAuth();
  const [partyType, setPartyType] = useState('seller');
  const [parties, setParties] = useState([]);
  const [balances, setBalances] = useState({});
  const [recentPayments, setRecentPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formData, setFormData] = useState({
    partyId: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, partyType]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');

      const table = partyType === 'seller' ? 'sellers' : 'buyers';
      const balanceView = partyType === 'seller' ? 'seller_balances' : 'buyer_balances';
      const balanceKey = partyType === 'seller' ? 'seller_id' : 'buyer_id';

      const [partiesResult, balancesResult, paymentsResult] = await Promise.all([
        supabase
          .from(table)
          .select('id, name, store_name, status')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('name', { ascending: true }),
        supabase
          .from(balanceView)
          .select(`${balanceKey}, running_balance`)
          .eq('user_id', user.id),
        supabase
          .from('payments')
          .select('id, direction, party_type, party_id, amount, date, payment_type, created_at')
          .eq('user_id', user.id)
          .eq('party_type', partyType)
          .order('date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      if (partiesResult.error) throw partiesResult.error;
      if (balancesResult.error) throw balancesResult.error;
      if (paymentsResult.error) throw paymentsResult.error;

      const balanceMap = {};
      (balancesResult.data || []).forEach((row) => {
        balanceMap[row[balanceKey]] = row.running_balance;
      });

      setParties(partiesResult.data || []);
      setBalances(balanceMap);
      setRecentPayments(paymentsResult.data || []);
    } catch (err) {
      setError(err.message || 'Failed to load payment data');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handlePartyTypeChange = (value) => {
    setPartyType(value);
    setFormData({
      partyId: '',
      amount: '',
      date: new Date().toISOString().slice(0, 10),
    });
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
        payment_type: 'settlement',
        date: formData.date,
        linked_purchase_id: null,
        linked_sale_id: null,
      };

      const { error: err } = await supabase.from('payments').insert(payload);
      if (err) throw err;

      const partyName = parties.find(p => p.id === formData.partyId)?.name || 'party';
      const actionLabel = partyType === 'seller' ? 'Paid to' : 'Received from';
      setSuccess(`${actionLabel} ${partyName}: ${formatCurrency(amount)}`);
      setFormData(prev => ({
        ...prev,
        partyId: '',
        amount: '',
      }));
      await loadData();
    } catch (err) {
      setError(err.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  const selectedParty = parties.find(p => p.id === formData.partyId);
  const selectedBalance = formData.partyId ? balances[formData.partyId] : null;
  const balanceInfo = selectedBalance !== null && selectedBalance !== undefined
    ? formatBalanceLabel(selectedBalance)
    : null;

  const partyNameMap = Object.fromEntries(parties.map(p => [p.id, p.name]));

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
          <p>
            {partyType === 'seller'
              ? 'Pay a seller directly — no purchase required.'
              : 'Record money received from a buyer — no sale required.'}
          </p>
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
            <SearchableSelect
              value={formData.partyId}
              onChange={(partyId) => setFormData(prev => ({ ...prev, partyId }))}
              placeholder={`Search ${partyType}s...`}
              emptyText={`No ${partyType} matches`}
              options={parties.map(party => ({
                value: party.id,
                label: party.store_name ? `${party.name} • ${party.store_name}` : party.name,
              }))}
            />
          </div>

          {selectedParty && balanceInfo && (
            <div className="payment-balance-card">
              <span>Current balance with {selectedParty.name}</span>
              <strong className={`balance-pill ${balanceInfo.className}`}>
                {balanceInfo.amount === 0
                  ? 'Settled'
                  : `${balanceInfo.label}: ${formatCurrency(balanceInfo.amount)}`}
              </strong>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label>Date *</label>
              <input type="date" name="date" value={formData.date} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label>{partyType === 'seller' ? 'Amount Paid *' : 'Amount Received *'}</label>
              <input
                type="number"
                name="amount"
                value={formData.amount}
                onChange={handleChange}
                min="0"
                step="0.01"
                placeholder="0.00"
                required
              />
            </div>
          </div>

          {selectedParty && formData.amount && Number(formData.amount) > 0 && balanceInfo && (
            <div className="payment-summary">
              <p>
                After this payment, balance with <strong>{selectedParty.name}</strong> will become{' '}
                <strong>
                  {(() => {
                    const current = Number(selectedBalance || 0);
                    const paid = Number(formData.amount);
                    const next = partyType === 'seller' ? current - paid : current - paid;
                    const nextInfo = formatBalanceLabel(next);
                    return nextInfo.amount === 0
                      ? 'Settled'
                      : `${nextInfo.label}: ${formatCurrency(nextInfo.amount)}`;
                  })()}
                </strong>.
              </p>
            </div>
          )}

          <div className="form-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setFormData({
                partyId: '',
                amount: '',
                date: new Date().toISOString().slice(0, 10),
              })}
            >
              Reset
            </button>
            <button type="submit" className="btn-primary btn-with-icon" disabled={saving}>
              <Plus size={18} />
              {saving ? 'Saving...' : partyType === 'seller' ? 'Record Payment to Seller' : 'Record Payment from Buyer'}
            </button>
          </div>
        </form>

        {recentPayments.length > 0 && (
          <section className="recent-payments">
            <h2>Recent Standalone Payments</h2>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Party</th>
                    <th>Direction</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map(payment => (
                    <tr key={payment.id}>
                      <td>{payment.date}</td>
                      <td>{partyNameMap[payment.party_id] || 'Unknown'}</td>
                      <td>{payment.direction === 'to_seller' ? 'Paid to Seller' : 'Received from Buyer'}</td>
                      <td>{formatCurrency(payment.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default RecordPayment;
