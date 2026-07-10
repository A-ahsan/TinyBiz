import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { formatCurrency } from '../utils/helpers';
import './Reports.css';

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
};

const Reports = () => {
  const { user } = useAuth();
  const [rangeMode, setRangeMode] = useState('whole');
  const [fromDate, setFromDate] = useState(monthStartIso());
  const [toDate, setToDate] = useState(todayIso());
  const [activeTab, setActiveTab] = useState('transactions');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [sellerBalances, setSellerBalances] = useState([]);
  const [buyerBalances, setBuyerBalances] = useState([]);
  const [categories, setCategories] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [categoryRows, setCategoryRows] = useState([]);
  const [sellerDirectory, setSellerDirectory] = useState({});
  const [buyerDirectory, setBuyerDirectory] = useState({});
  const [profitRows, setProfitRows] = useState([]);
  const [summary, setSummary] = useState({
    transactionCount: 0,
    saleValue: 0,
    costOfGoods: 0,
    profit: 0,
  });

  useEffect(() => {
    if (user) {
      loadReports();
    }
  }, [user, rangeMode, fromDate, toDate]);

  const loadReports = async () => {
    try {
      setLoading(true);
      setError('');

      const applyRange = (query) => {
        if (rangeMode === 'date') {
          return query.gte('date', fromDate).lte('date', toDate);
        }
        return query;
      };

      const [purchasesResult, salesResult] = await Promise.all([
        applyRange(
          supabase
            .from('purchases')
            .select('id, date, quantity, buying_rate, total_cost, amount_paid, remaining_qty, status, seller_id, product_id')
            .eq('user_id', user.id)
        ),
        applyRange(
          supabase
            .from('sales')
            .select('id, date, buyer_id, invoice_number, amount_received, status')
            .eq('user_id', user.id)
        ),
      ]);

      if (purchasesResult.error) throw purchasesResult.error;
      if (salesResult.error) throw salesResult.error;

      const purchases = purchasesResult.data || [];
      const sales = salesResult.data || [];
      const saleIds = sales.map(row => row.id);

      const lineItemsResult = saleIds.length
        ? await supabase
            .from('sale_line_items')
            .select('id, sale_id, product_id, quantity, sale_rate, line_total')
            .in('sale_id', saleIds)
        : { data: [], error: null };

      if (lineItemsResult.error) throw lineItemsResult.error;

      const lineItems = lineItemsResult.data || [];
      const lineItemIds = lineItems.map(row => row.id);

      const allocationsResult = lineItemIds.length
        ? await supabase
            .from('sale_allocations')
            .select('sale_line_item_id, cost_allocated')
            .in('sale_line_item_id', lineItemIds)
        : { data: [], error: null };

      if (allocationsResult.error) throw allocationsResult.error;

      const allocations = allocationsResult.data || [];

      const sellerIds = [...new Set(purchases.map(row => row.seller_id).filter(Boolean))];
      const buyerIds = [...new Set(sales.map(row => row.buyer_id).filter(Boolean))];
      const productIds = [...new Set([
        ...purchases.map(row => row.product_id),
        ...lineItems.map(row => row.product_id),
      ].filter(Boolean))];

      const [sellersResult, buyersResult, productsResult, categoriesResult] = await Promise.all([
        sellerIds.length
          ? supabase.from('sellers').select('id, name, store_name').in('id', sellerIds)
          : Promise.resolve({ data: [] }),
        buyerIds.length
          ? supabase.from('buyers').select('id, name, store_name').in('id', buyerIds)
          : Promise.resolve({ data: [] }),
        productIds.length
          ? supabase.from('products').select('*').in('id', productIds)
          : Promise.resolve({ data: [] }),
        supabase
          .from('product_categories')
          .select('id, name')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('name', { ascending: true }),
      ]);

      if (sellersResult.error) throw sellersResult.error;
      if (buyersResult.error) throw buyersResult.error;
      if (productsResult.error) throw productsResult.error;
      if (categoriesResult.error) throw categoriesResult.error;

      const sellerMap = Object.fromEntries((sellersResult.data || []).map(row => [row.id, row]));
      const buyerMap = Object.fromEntries((buyersResult.data || []).map(row => [row.id, row]));
      const productMap = Object.fromEntries((productsResult.data || []).map(row => [row.id, row]));
      const categoryMap = Object.fromEntries((categoriesResult.data || []).map(row => [row.id, row]));

      const costMap = allocations.reduce((map, row) => {
        map[row.sale_line_item_id] = (map[row.sale_line_item_id] || 0) + Number(row.cost_allocated || 0);
        return map;
      }, {});

      const saleLineMap = lineItems.reduce((map, row) => {
        if (!map[row.sale_id]) map[row.sale_id] = [];
        map[row.sale_id].push(row);
        return map;
      }, {});

      const purchaseRows = purchases.map(row => {
        const seller = sellerMap[row.seller_id];
        const product = productMap[row.product_id];
        const total = Number(row.total_cost || 0);
        const paid = Number(row.amount_paid || 0);
        const balance = total - paid;

        return {
          id: row.id,
          key: `purchase-${row.id}`,
          date: row.date,
          type: 'Purchase',
          party: seller ? `${seller.name}${seller.store_name ? ` - ${seller.store_name}` : ''}` : 'Unknown seller',
          products: product ? product.name : 'Unknown product',
          quantity: Number(row.quantity || 0),
          rate: Number(row.buying_rate || 0),
          total,
          paid,
          status: row.status,
          balance,
          direction: balance > 0 ? 'Due' : balance < 0 ? 'Advance' : 'Settled',
          profit: null,
          cost: total,
        };
      });

      const saleRows = sales.map(row => {
        const buyer = buyerMap[row.buyer_id];
        const items = saleLineMap[row.id] || [];
        const saleValue = items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
        const costOfGoods = items.reduce((sum, item) => sum + Number(costMap[item.id] || 0), 0);
        const productNames = [...new Set(items.map(item => productMap[item.product_id]?.name).filter(Boolean))].join(', ') || 'Unknown product';
        const quantityByProduct = items
          .map((item) => {
            const productName = productMap[item.product_id]?.name || 'Unknown product';
            const qty = Number(item.quantity || 0).toFixed(3);
            return `${productName}: ${qty}`;
          })
          .join(', ');
        const balance = saleValue - Number(row.amount_received || 0);
        const profit = saleValue - costOfGoods;

        return {
          id: row.id,
          key: `sale-${row.id}`,
          date: row.date,
          type: 'Sale',
          party: buyer ? `${buyer.name}${buyer.store_name ? ` - ${buyer.store_name}` : ''}` : 'Unknown buyer',
          products: productNames,
          quantityText: quantityByProduct || '-',
          rate: null,
          total: saleValue,
          paid: Number(row.amount_received || 0),
          status: row.status,
          balance,
          direction: balance > 0 ? 'Due' : balance < 0 ? 'Advance' : 'Settled',
          profit,
          cost: costOfGoods,
          saleId: row.id,
          invoice: row.invoice_number,
        };
      });

      const categoryAggMap = {};
      lineItems.forEach((line) => {
        const product = productMap[line.product_id] || {};
        const categoryId = product.category_id || '__uncategorized__';
        const categoryName = categoryId === '__uncategorized__'
          ? 'Uncategorized'
          : (categoryMap[categoryId]?.name || 'Uncategorized');
        const rowKey = `${categoryId}::${line.product_id}`;

        if (!categoryAggMap[rowKey]) {
          categoryAggMap[rowKey] = {
            key: rowKey,
            categoryId,
            categoryName,
            productId: line.product_id,
            productName: product.name || 'Unknown product',
            qtySold: 0,
            saleValue: 0,
            costOfGoods: 0,
            profit: 0,
            invoiceIds: new Set(),
          };
        }

        const current = categoryAggMap[rowKey];
        const qty = Number(line.quantity || 0);
        const saleValue = Number(line.line_total || 0);
        const cost = Number(costMap[line.id] || 0);
        current.qtySold += qty;
        current.saleValue += saleValue;
        current.costOfGoods += cost;
        current.profit += (saleValue - cost);
        current.invoiceIds.add(line.sale_id);
      });

      const categoryProfitRows = Object.values(categoryAggMap)
        .map((row) => ({
          ...row,
          invoiceCount: row.invoiceIds.size,
        }))
        .sort((a, b) => {
          if (a.categoryName === b.categoryName) return a.productName.localeCompare(b.productName);
          return a.categoryName.localeCompare(b.categoryName);
        });

      const combinedTransactions = [...purchaseRows, ...saleRows].sort((a, b) => {
        if (a.date === b.date) return a.key.localeCompare(b.key);
        return b.date.localeCompare(a.date);
      });

      const saleValue = saleRows.reduce((sum, row) => sum + row.total, 0);
      const costOfGoods = saleRows.reduce((sum, row) => sum + row.cost, 0);
      const profit = saleValue - costOfGoods;

      const [sellerBalancesResult, buyerBalancesResult] = await Promise.all([
        supabase.from('seller_balances').select('seller_id, user_id, running_balance').eq('user_id', user.id),
        supabase.from('buyer_balances').select('buyer_id, user_id, running_balance').eq('user_id', user.id),
      ]);

      if (sellerBalancesResult.error) throw sellerBalancesResult.error;
      if (buyerBalancesResult.error) throw buyerBalancesResult.error;

      setTransactions(combinedTransactions);
      setProfitRows(saleRows);
      setCategories(categoriesResult.data || []);
      setCategoryRows(categoryProfitRows);
      setSellerBalances(sellerBalancesResult.data || []);
      setBuyerBalances(buyerBalancesResult.data || []);
      setSellerDirectory(sellerMap);
      setBuyerDirectory(buyerMap);
      setSummary({
        transactionCount: combinedTransactions.length,
        saleValue,
        costOfGoods,
        profit,
      });
    } catch (err) {
      setError(err.message || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  const filteredTransactions = useMemo(() => transactions, [transactions]);
  const filteredCategoryRows = useMemo(() => {
    if (categoryFilter === 'all') return categoryRows;
    if (categoryFilter === '__uncategorized__') {
      return categoryRows.filter(row => row.categoryId === '__uncategorized__');
    }
    return categoryRows.filter(row => row.categoryId === categoryFilter);
  }, [categoryRows, categoryFilter]);

  const downloadCategoryCsv = () => {
    const header = ['Category', 'Product', 'Qty Sold', 'Sale Value', 'Cost of Goods', 'Profit', 'Invoice Count'];
    const rows = filteredCategoryRows.map((row) => ([
      row.categoryName,
      row.productName,
      row.qtySold.toFixed(3),
      row.saleValue.toFixed(2),
      row.costOfGoods.toFixed(2),
      row.profit.toFixed(2),
      String(row.invoiceCount),
    ]));

    const csv = [header, ...rows]
      .map(cols => cols.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `category-profit-${rangeMode === 'date' ? `${fromDate}-to-${toDate}` : 'whole'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadCategoryPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    let y = 14;
    doc.setFontSize(14);
    doc.text('Category-wise Product Profit Log', 14, y);
    y += 7;
    doc.setFontSize(10);
    doc.text(
      rangeMode === 'date' ? `Range: ${fromDate} to ${toDate}` : 'Range: Whole data',
      14,
      y,
    );
    y += 8;

    doc.setFontSize(9);
    doc.text('Category', 14, y);
    doc.text('Product', 58, y);
    doc.text('Qty', 122, y);
    doc.text('Sale', 145, y);
    doc.text('Cost', 176, y);
    doc.text('Profit', 207, y);
    doc.text('Inv', 258, y);
    y += 2;
    doc.line(14, y, 280, y);
    y += 6;

    filteredCategoryRows.forEach((row) => {
      if (y > 190) {
        doc.addPage('a4', 'landscape');
        y = 14;
      }
      doc.text(row.categoryName.slice(0, 24), 14, y);
      doc.text(row.productName.slice(0, 30), 58, y);
      doc.text(row.qtySold.toFixed(3), 122, y);
      doc.text(formatCurrency(row.saleValue), 145, y);
      doc.text(formatCurrency(row.costOfGoods), 176, y);
      doc.text(formatCurrency(row.profit), 207, y);
      doc.text(String(row.invoiceCount), 258, y);
      y += 6;
    });

    doc.save(`category-profit-${rangeMode === 'date' ? `${fromDate}-to-${toDate}` : 'whole'}.pdf`);
  };

  const dueSellers = sellerBalances.filter(row => Number(row.running_balance || 0) > 0);
  const advanceSellers = sellerBalances.filter(row => Number(row.running_balance || 0) < 0);
  const dueBuyers = buyerBalances.filter(row => Number(row.running_balance || 0) > 0);
  const advanceBuyers = buyerBalances.filter(row => Number(row.running_balance || 0) < 0);

  const renderRangeControls = () => (
    <div className="report-toolbar">
      <div className="toggle-group">
        <button className={`toggle-btn ${rangeMode === 'whole' ? 'active' : ''}`} onClick={() => setRangeMode('whole')} type="button">Whole</button>
        <button className={`toggle-btn ${rangeMode === 'date' ? 'active' : ''}`} onClick={() => setRangeMode('date')} type="button">Date Range</button>
      </div>
      {rangeMode === 'date' && (
        <div className="date-range-grid">
          <label>
            <span>From</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="page-container">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="page-container reports-page">
      <div className="page-header">
        <div>
          <h1>Reports & Logs</h1>
          <p>View detailed reports on transactions, balances, and profit.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="report-summary-grid">
        <div className="summary-card">
          <span className="summary-label">Transactions</span>
          <strong>{summary.transactionCount}</strong>
        </div>
        <div className="summary-card">
          <span className="summary-label">Sale Value</span>
          <strong>{formatCurrency(summary.saleValue)}</strong>
        </div>
        <div className="summary-card">
          <span className="summary-label">Cost of Goods</span>
          <strong>{formatCurrency(summary.costOfGoods)}</strong>
        </div>
        <div className="summary-card">
          <span className="summary-label">Profit</span>
          <strong>{formatCurrency(summary.profit)}</strong>
        </div>
      </div>

      {renderRangeControls()}

      <div className="report-tabs">
        <button type="button" className={`report-tab ${activeTab === 'transactions' ? 'active' : ''}`} onClick={() => setActiveTab('transactions')}>All Transactions</button>
        <button type="button" className={`report-tab ${activeTab === 'balances' ? 'active' : ''}`} onClick={() => setActiveTab('balances')}>Due / Advance</button>
        <button type="button" className={`report-tab ${activeTab === 'profit' ? 'active' : ''}`} onClick={() => setActiveTab('profit')}>Profit Log</button>
        <button type="button" className={`report-tab ${activeTab === 'category' ? 'active' : ''}`} onClick={() => setActiveTab('category')}>Category-wise Profit</button>
      </div>

      {activeTab === 'transactions' && (
        <section className="report-section">
          <h2>All Transactions Log</h2>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Party</th>
                  <th>Product(s)</th>
                  <th>Quantity</th>
                  <th>Rate</th>
                  <th>Total</th>
                  <th>Paid / Received</th>
                  <th>Remaining</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.length === 0 ? (
                  <tr><td colSpan="11" className="empty-row">No transactions in this range.</td></tr>
                ) : filteredTransactions.map(row => (
                  <tr key={row.key}>
                    <td>{row.date}</td>
                    <td><span className={`type-pill ${row.type.toLowerCase()}`}>{row.type}</span></td>
                    <td>{row.party}</td>
                    <td>{row.products}</td>
                    <td>{row.quantityText || (row.quantity ? row.quantity.toFixed(3) : '-')}</td>
                    <td>{row.rate === null || row.rate === undefined ? '-' : formatCurrency(row.rate)}</td>
                    <td>{formatCurrency(row.total)}</td>
                    <td>{formatCurrency(row.paid)}</td>
                    <td>{Number(row.balance || 0) !== 0 ? formatCurrency(Math.abs(Number(row.balance || 0))) : ''}</td>
                    <td>
                      <span className={`balance-pill ${row.status === 'voided' ? 'voided' : row.direction.toLowerCase()}`}>
                        {row.status === 'voided' ? 'Voided' : row.direction}
                      </span>
                    </td>
                    <td>
                      {row.type === 'Sale' ? (
                        <div className="report-actions-inline">
                          <Link to={`/invoice/${row.saleId}`} className="report-action-btn">View</Link>
                          <a href={`/invoice/${row.saleId}?autodownload=1`} className="report-action-btn">PDF</a>
                        </div>
                      ) : (
                        <span className="report-action-muted">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'balances' && (
        <section className="balance-grid">
          <div className="report-section">
            <h2>Buyers who owe me</h2>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Party Name</th>
                    <th>Total Due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dueBuyers.length === 0 ? <tr><td colSpan="3" className="empty-row">No buyer dues.</td></tr> : dueBuyers.map(row => (
                    <tr key={row.buyer_id}>
                      <td>{buyerDirectory[row.buyer_id]?.name || row.buyer_id}</td>
                      <td>{formatCurrency(Math.abs(row.running_balance || 0))}</td>
                      <td><span className="balance-pill due">Due</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="report-section">
            <h2>I owe these sellers</h2>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Party Name</th>
                    <th>Total Due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dueSellers.length === 0 ? <tr><td colSpan="3" className="empty-row">No seller dues.</td></tr> : dueSellers.map(row => (
                    <tr key={row.seller_id}>
                      <td>{sellerDirectory[row.seller_id]?.name || row.seller_id}</td>
                      <td>{formatCurrency(Math.abs(row.running_balance || 0))}</td>
                      <td><span className="balance-pill due">Due</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="report-section">
            <h2>Buyer advances</h2>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Party Name</th>
                    <th>Total Advance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {advanceBuyers.length === 0 ? <tr><td colSpan="3" className="empty-row">No buyer advances.</td></tr> : advanceBuyers.map(row => (
                    <tr key={row.buyer_id}>
                      <td>{buyerDirectory[row.buyer_id]?.name || row.buyer_id}</td>
                      <td>{formatCurrency(Math.abs(row.running_balance || 0))}</td>
                      <td><span className="balance-pill advance">Advance</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="report-section">
            <h2>Seller advances</h2>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Party Name</th>
                    <th>Total Advance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {advanceSellers.length === 0 ? <tr><td colSpan="3" className="empty-row">No seller advances.</td></tr> : advanceSellers.map(row => (
                    <tr key={row.seller_id}>
                      <td>{sellerDirectory[row.seller_id]?.name || row.seller_id}</td>
                      <td>{formatCurrency(Math.abs(row.running_balance || 0))}</td>
                      <td><span className="balance-pill advance">Advance</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'profit' && (
        <section className="report-section">
          <h2>Profit Log</h2>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice #</th>
                  <th>Buyer</th>
                  <th>Product(s)</th>
                  <th>Sale Value</th>
                  <th>Cost of Goods</th>
                  <th>Profit</th>
                </tr>
              </thead>
              <tbody>
                {profitRows.length === 0 ? (
                  <tr><td colSpan="7" className="empty-row">No sales in this range.</td></tr>
                ) : profitRows.map(row => (
                  <tr key={row.key}>
                    <td>{row.date}</td>
                    <td>{row.invoice}</td>
                    <td>{row.party}</td>
                    <td>{row.products}</td>
                    <td>{formatCurrency(row.total)}</td>
                    <td>{formatCurrency(row.cost)}</td>
                    <td>{formatCurrency(row.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'category' && (
        <section className="report-section">
          <div className="report-section-header">
            <h2>Category-wise Product Log</h2>
            <div className="category-report-actions">
              <button type="button" className="report-action-btn" onClick={downloadCategoryCsv}>Download CSV (Excel)</button>
              <button type="button" className="report-action-btn" onClick={downloadCategoryPdf}>Download PDF</button>
            </div>
          </div>

          <div className="category-filter-row">
            <label>
              <span>Category</span>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">All categories</option>
                <option value="__uncategorized__">Uncategorized</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Product</th>
                  <th>Qty Sold</th>
                  <th>Sale Value</th>
                  <th>Cost of Goods</th>
                  <th>Profit</th>
                  <th>Invoices</th>
                </tr>
              </thead>
              <tbody>
                {filteredCategoryRows.length === 0 ? (
                  <tr><td colSpan="7" className="empty-row">No category rows in this range.</td></tr>
                ) : filteredCategoryRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.categoryName}</td>
                    <td>{row.productName}</td>
                    <td>{row.qtySold.toFixed(3)}</td>
                    <td>{formatCurrency(row.saleValue)}</td>
                    <td>{formatCurrency(row.costOfGoods)}</td>
                    <td>{formatCurrency(row.profit)}</td>
                    <td>{row.invoiceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export default Reports;