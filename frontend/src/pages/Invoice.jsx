import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { formatCurrency } from '../utils/helpers';
import './Invoice.css';

const Invoice = () => {
  const { saleId } = useParams();
  const location = useLocation();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sale, setSale] = useState(null);
  const [buyer, setBuyer] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [products, setProducts] = useState([]);

  useEffect(() => {
    if (saleId) {
      loadInvoice();
    }
  }, [saleId]);

  const loadInvoice = async () => {
    try {
      setLoading(true);
      setError('');

      const { data: saleData, error: saleErr } = await supabase
        .from('sales')
        .select('id, date, invoice_number, amount_received, status, buyer_id')
        .eq('id', saleId)
        .single();

      if (saleErr) throw saleErr;

      const { data: buyerData, error: buyerErr } = await supabase
        .from('buyers')
        .select('id, name, store_name, location, email, phone')
        .eq('id', saleData.buyer_id)
        .single();

      if (buyerErr) throw buyerErr;

      const { data: lineData, error: lineErr } = await supabase
        .from('sale_line_items')
        .select('id, product_id, quantity, sale_rate, line_total')
        .eq('sale_id', saleId);

      if (lineErr) throw lineErr;

      const productIds = [...new Set((lineData || []).map(item => item.product_id))];

      const [productResult] = await Promise.all([
        productIds.length
          ? supabase.from('products').select('id, name, unit').in('id', productIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (productResult.error) throw productResult.error;

      setSale(saleData);
      setBuyer(buyerData);
      setLineItems(lineData || []);
      setProducts(productResult.data || []);
    } catch (err) {
      setError(err.message || 'Failed to load invoice');
    } finally {
      setLoading(false);
    }
  };

  const summary = useMemo(() => {
    const subtotal = lineItems.reduce((sum, line) => sum + Number(line.line_total || 0), 0);
    const amountReceived = Number(sale?.amount_received || 0);
    return {
      subtotal,
      due: Math.max(subtotal - amountReceived, 0),
      advance: Math.max(amountReceived - subtotal, 0),
    };
  }, [lineItems, sale]);

  const getProductName = (productId) => products.find(product => product.id === productId)?.name || 'Unknown product';

  const downloadPdf = () => {
    if (!sale || !buyer) return;

    const doc = new jsPDF();
    let y = 16;

    doc.setFontSize(18);
    doc.text(profile?.business_name || 'TinyBiz', 14, y);
    y += 8;
    doc.setFontSize(12);
    doc.text('Invoice', 14, y);
    y += 10;

    doc.setFontSize(10);
    doc.text(`Invoice #: ${sale.invoice_number}`, 14, y);
    doc.text(`Date: ${sale.date}`, 120, y);
    y += 6;
    doc.text(`Buyer: ${buyer.name}${buyer.store_name ? ` (${buyer.store_name})` : ''}`, 14, y);
    y += 10;

    doc.setFontSize(11);
    doc.text('Items', 14, y);
    y += 6;

    lineItems.forEach((line, index) => {
      const productName = getProductName(line.product_id);
      doc.setFontSize(10);
      doc.text(`${index + 1}. ${productName}`, 14, y);
      doc.text(`Qty: ${line.quantity}`, 90, y);
      doc.text(`Rate: ${formatCurrency(line.sale_rate)}`, 130, y);
      doc.text(`Total: ${formatCurrency(line.line_total)}`, 170, y);
      y += 6;
    });

    y += 4;
    doc.line(14, y, 196, y);
    y += 8;
    doc.text(`Subtotal: ${formatCurrency(summary.subtotal)}`, 14, y);
    y += 6;
    doc.text(`Amount Received: ${formatCurrency(Number(sale.amount_received || 0))}`, 14, y);
    y += 6;
    doc.text(`Due: ${formatCurrency(summary.due)}`, 14, y);
    y += 6;
    doc.text(`Advance: ${formatCurrency(summary.advance)}`, 14, y);

    doc.save(`${sale.invoice_number || 'invoice'}.pdf`);
  };

  useEffect(() => {
    if (loading || !sale || !buyer) return;
    const params = new URLSearchParams(location.search);
    const shouldAutoDownload = params.get('autodownload') === '1';
    if (shouldAutoDownload) {
      downloadPdf();
    }
  }, [loading, sale, buyer, location.search]);

  if (loading) {
    return (
      <div className="page-container">
        <div className="spinner"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="alert alert-error">{error}</div>
        <Link to="/sale" className="btn-primary">Back to Sale</Link>
      </div>
    );
  }

  return (
    <div className="page-container invoice-page">
      <div className="page-header">
        <div>
          <h1>Invoice</h1>
          <p>Printable sale invoice and PDF export.</p>
        </div>
        <div className="invoice-actions">
          <button type="button" className="btn-secondary" onClick={downloadPdf}>Download PDF</button>
          <Link to="/sale" className="btn-primary">New Sale</Link>
        </div>
      </div>

      <div className="invoice-card">
        <div className="invoice-top">
          <div>
            <h2>{profile?.business_name || 'TinyBiz'}</h2>
            <p>{profile?.name || 'Business owner'}</p>
          </div>
          <div className="invoice-meta">
            <p><strong>Invoice #:</strong> {sale.invoice_number}</p>
            <p><strong>Date:</strong> {sale.date}</p>
            <p><strong>Status:</strong> {sale.status}</p>
          </div>
        </div>

        <div className="invoice-buyer">
          <h3>Bill To</h3>
          <p>{buyer?.name}</p>
          {buyer?.store_name && <p>{buyer.store_name}</p>}
          {buyer?.location && <p>{buyer.location}</p>}
          {buyer?.email && <p>{buyer.email}</p>}
          {buyer?.phone && <p>{buyer.phone}</p>}
        </div>

        <div className="report-table-wrap">
          <table className="report-table invoice-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity</th>
                <th>Sale Rate</th>
                <th>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map(line => (
                <tr key={line.id}>
                  <td>{getProductName(line.product_id)}</td>
                  <td>{Number(line.quantity || 0).toFixed(3)}</td>
                  <td>{formatCurrency(line.sale_rate)}</td>
                  <td>{formatCurrency(line.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="invoice-summary">
          <div><span>Subtotal</span><strong>{formatCurrency(summary.subtotal)}</strong></div>
          <div><span>Amount Received</span><strong>{formatCurrency(Number(sale.amount_received || 0))}</strong></div>
          <div><span>Due</span><strong>{formatCurrency(summary.due)}</strong></div>
          <div><span>Advance</span><strong>{formatCurrency(summary.advance)}</strong></div>
        </div>
      </div>
    </div>
  );
};

export default Invoice;
