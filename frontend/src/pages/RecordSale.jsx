import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import './Page.css';
import './RecordPurchase.css';

const emptyLine = () => ({ product_id: '', quantity: '', sale_rate: '' });

const RecordSale = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [buyers, setBuyers] = useState([]);
  const [products, setProducts] = useState([]);
  const [lines, setLines] = useState([emptyLine()]);
  const [buyerId, setBuyerId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [amountReceived, setAmountReceived] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAddBuyer, setShowAddBuyer] = useState(false);
  const [newBuyer, setNewBuyer] = useState({ name: '', store_name: '' });

  useEffect(() => {
    if (user) loadPickers();
  }, [user]);

  const loadPickers = async () => {
    setLoading(true);
    try {
      const [{ data: buyersData, error: buyersErr }, { data: productsData, error: productsErr }] = await Promise.all([
        supabase.from('buyers').select('*').eq('user_id', user.id).eq('status', 'active').order('name'),
        supabase.from('products').select('*').eq('user_id', user.id).eq('status', 'active').order('name'),
      ]);

      if (buyersErr) throw buyersErr;
      if (productsErr) throw productsErr;

      setBuyers(buyersData || []);
      setProducts(productsData || []);
    } catch (err) {
      console.error(err);
      setError('Failed to load buyers or products');
    } finally {
      setLoading(false);
    }
  };

  const handleNewBuyerChange = (e) => {
    const { name, value } = e.target;
    setNewBuyer(prev => ({ ...prev, [name]: value }));
  };

  const addBuyer = async () => {
    if (!newBuyer.name.trim()) return setError('Buyer name is required');
    try {
      setSubmitting(true);
      const payload = { user_id: user.id, name: newBuyer.name.trim(), store_name: newBuyer.store_name.trim() || null };
      const { data, error: insErr } = await supabase.from('buyers').insert([payload]).select().single();
      if (insErr) throw insErr;
      await loadPickers();
      setBuyerId(data.id);
      setShowAddBuyer(false);
      setNewBuyer({ name: '', store_name: '' });
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to add buyer');
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
  const removeLine = (i) => setLines(prev => prev.filter((_, idx) => idx !== i));

  const handleProductChange = (idx, productId) => {
    const prod = products.find(p => p.id === productId);
    updateLine(idx, { product_id: productId, sale_rate: prod?.set_rate ?? '' });
  };

  const computeTotals = () => lines.reduce((total, line) => {
    const quantity = Number(line.quantity || 0);
    const rate = Number(line.sale_rate || 0);
    return total + quantity * rate;
  }, 0);

  const cleanupPartialSale = async ({ saleId, lineItemIds, allocationIds, purchaseAdjustments }) => {
    for (const allocationId of allocationIds.reverse()) {
      await supabase.from('sale_allocations').delete().eq('id', allocationId);
    }

    for (const lineItemId of lineItemIds.reverse()) {
      await supabase.from('sale_line_items').delete().eq('id', lineItemId);
    }

    for (const adjustment of purchaseAdjustments.reverse()) {
      await supabase
        .from('purchases')
        .update({ remaining_qty: adjustment.previousRemainingQty })
        .eq('id', adjustment.purchaseId);
    }

    await supabase.from('sales').delete().eq('id', saleId);
  };

  const fallbackRecordSale = async ({ invoiceNumber, cleanedLines, amountReceivedValue }) => {
    const { data: saleRow, error: saleErr } = await supabase
      .from('sales')
      .insert({
        user_id: user.id,
        buyer_id: buyerId,
        invoice_number: invoiceNumber,
        date,
        amount_received: amountReceivedValue,
      })
      .select()
      .single();

    if (saleErr) throw saleErr;

    const lineItemIds = [];
    const allocationIds = [];
    const purchaseAdjustments = [];

    try {
      for (const line of cleanedLines) {
        const { data: purchaseRows, error: purchaseErr } = await supabase
          .from('purchases')
          .select('id, remaining_qty, buying_rate, date, created_at')
          .eq('user_id', user.id)
          .eq('product_id', line.product_id)
          .eq('status', 'active')
          .gt('remaining_qty', 0)
          .order('date', { ascending: true })
          .order('created_at', { ascending: true });

        if (purchaseErr) throw purchaseErr;

        const availableQty = (purchaseRows || []).reduce((sum, row) => sum + Number(row.remaining_qty || 0), 0);
        if (availableQty < line.quantity) {
          throw new Error(`Insufficient stock for selected product. Available ${availableQty}, requested ${line.quantity}.`);
        }

        const { data: lineRow, error: lineErr } = await supabase
          .from('sale_line_items')
          .insert({
            sale_id: saleRow.id,
            product_id: line.product_id,
            quantity: line.quantity,
            sale_rate: line.sale_rate,
          })
          .select()
          .single();

        if (lineErr) throw lineErr;
        lineItemIds.push(lineRow.id);

        let remainingToAllocate = line.quantity;
        for (const purchaseRow of purchaseRows || []) {
          if (remainingToAllocate <= 0) break;

          const currentRemaining = Number(purchaseRow.remaining_qty || 0);
          if (currentRemaining <= 0) continue;

          const quantityAllocated = Math.min(currentRemaining, remainingToAllocate);
          const costAllocated = Number((quantityAllocated * Number(purchaseRow.buying_rate || 0)).toFixed(2));

          const { data: allocationRow, error: allocationErr } = await supabase
            .from('sale_allocations')
            .insert({
              sale_line_item_id: lineRow.id,
              purchase_id: purchaseRow.id,
              quantity_allocated: quantityAllocated,
              cost_allocated: costAllocated,
            })
            .select()
            .single();

          if (allocationErr) throw allocationErr;
          allocationIds.push(allocationRow.id);

          const newRemaining = Number((currentRemaining - quantityAllocated).toFixed(3));
          const { error: updateErr } = await supabase
            .from('purchases')
            .update({ remaining_qty: newRemaining })
            .eq('id', purchaseRow.id);

          if (updateErr) throw updateErr;

          purchaseAdjustments.push({ purchaseId: purchaseRow.id, previousRemainingQty: currentRemaining });
          remainingToAllocate = Number((remainingToAllocate - quantityAllocated).toFixed(3));
        }
      }

      return saleRow.id;
    } catch (err) {
      await cleanupPartialSale({ saleId: saleRow.id, lineItemIds, allocationIds, purchaseAdjustments });
      throw err;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!buyerId) return setError('Please select a buyer');

    const cleanedLines = lines.map(line => ({
      product_id: line.product_id,
      quantity: Number(line.quantity),
      sale_rate: Number(line.sale_rate),
    }));

    if (cleanedLines.some(line => !line.product_id || !line.quantity || line.quantity <= 0 || Number.isNaN(line.sale_rate))) {
      return setError('Please complete all line items');
    }

    const invoiceNumber = `INV-${Date.now()}`;

    try {
      setSubmitting(true);
      const amountReceivedValue = amountReceived ? Number(amountReceived) : 0;

      const { data, error: rpcErr } = await supabase.rpc('perform_sale', {
        p_buyer_id: buyerId,
        p_invoice_number: invoiceNumber,
        p_date: date,
        p_amount_received: amountReceivedValue,
        p_lines: JSON.stringify(cleanedLines),
      });

      let saleId = null;
      if (rpcErr) {
        const message = `${rpcErr.message || ''}`.toLowerCase();
        const missingRpc = rpcErr.code === 'PGRST202' || message.includes('could not find the function public.perform_sale');
        if (!missingRpc) throw rpcErr;
        saleId = await fallbackRecordSale({ invoiceNumber, cleanedLines, amountReceivedValue });
      } else {
        saleId = typeof data === 'string' ? data : data?.id || data?.toString?.();
      }

      setSuccess('Sale recorded successfully');
      setLines([emptyLine()]);
      setBuyerId('');
      setAmountReceived('');
      if (saleId) {
        navigate(`/invoice/${saleId}`);
      }
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to record sale');
    } finally {
      setSubmitting(false);
    }
  };

  const totalSale = computeTotals();
  const amtRec = Number(amountReceived || 0);
  const balance = totalSale - amtRec;

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
          <h1>Record Sale (Invoice)</h1>
          <p>Create a new invoice and allocate inventory (FIFO).</p>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <form className="purchase-form card" onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label>Buyer *</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select value={buyerId} onChange={e => setBuyerId(e.target.value)} required style={{ flex: 1 }}>
                <option value="">Select buyer</option>
                {buyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button type="button" className="btn-secondary" onClick={() => setShowAddBuyer(v => !v)}>{showAddBuyer ? 'Cancel' : 'Add'}</button>
            </div>

            {showAddBuyer && (
              <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                <input name="name" placeholder="Name *" value={newBuyer.name} onChange={handleNewBuyerChange} />
                <input name="store_name" placeholder="Store name (optional)" value={newBuyer.store_name} onChange={handleNewBuyerChange} />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" className="btn-primary" onClick={addBuyer} disabled={submitting}>Create Buyer</button>
                  <button type="button" className="btn-secondary" onClick={() => setShowAddBuyer(false)}>Cancel</button>
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
                <select value={line.product_id} onChange={e => handleProductChange(idx, e.target.value)} required>
                  <option value="">Select product</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Quantity</label>
                <input type="number" step="0.001" min="0.001" value={line.quantity} onChange={e => updateLine(idx, { quantity: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Sale Rate</label>
                <input type="number" step="0.01" min="0" value={line.sale_rate} onChange={e => updateLine(idx, { sale_rate: e.target.value })} required />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn-secondary" onClick={() => removeLine(idx)}>Remove</button>
              </div>
            </div>
          ))}
          <div style={{ marginTop: '0.5rem' }}>
            <button type="button" className="btn-secondary" onClick={addLine}>Add Line</button>
          </div>
        </div>

        <div style={{ marginTop: '1rem' }}>
          <div className="form-row">
            <div className="form-group">
              <label>Total Sale Value</label>
              <div style={{ padding: '0.5rem 0' }}>BDT {totalSale.toFixed(2)}</div>
            </div>
            <div className="form-group">
              <label>Amount Received</label>
              <input type="number" step="0.01" min="0" value={amountReceived} onChange={e => setAmountReceived(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Balance</label>
              <div style={{ padding: '0.5rem 0' }}>{balance >= 0 ? `Due BDT ${balance.toFixed(2)}` : `Advance BDT ${Math.abs(balance).toFixed(2)}`}</div>
            </div>
          </div>
        </div>

        <div className="form-actions" style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
          <button type="submit" className="btn-primary" disabled={submitting}>Submit Invoice</button>
        </div>
      </form>
    </div>
  );
};

export default RecordSale;