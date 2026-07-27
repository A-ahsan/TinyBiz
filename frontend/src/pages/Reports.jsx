import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { formatCurrency } from '../utils/helpers';
import SearchableSelect from '../components/SearchableSelect';
import './Reports.css';

// "Name - Store", but never "Name - Name" when the store repeats the person.
const partyLabel = (party, fallback) => {
  if (!party) return fallback;
  const name = (party.name || '').trim();
  const store = (party.store_name || '').trim();
  if (!store || store.toLowerCase() === name.toLowerCase()) return name || fallback;
  return `${name} - ${store}`;
};

// Newest first. Same-day entries fall back to created_at so they read in the
// order they were actually recorded.
const byRecentFirst = (a, b) => {
  if (a.date !== b.date) return String(b.date).localeCompare(String(a.date));
  const aCreated = a.createdAt || '';
  const bCreated = b.createdAt || '';
  if (aCreated !== bCreated) return bCreated.localeCompare(aCreated);
  return String(b.key).localeCompare(String(a.key));
};

const byOldestFirst = (a, b) => -byRecentFirst(a, b);

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
  const [productLogRows, setProductLogRows] = useState([]);
  const [productOptions, setProductOptions] = useState([]);
  const [productFilter, setProductFilter] = useState('all');
  const [productTypeFilter, setProductTypeFilter] = useState('all');
  const [buyerLogRows, setBuyerLogRows] = useState([]);
  const [sellerLogRows, setSellerLogRows] = useState([]);
  const [buyerOptions, setBuyerOptions] = useState([]);
  const [sellerOptions, setSellerOptions] = useState([]);
  const [buyerLogFilter, setBuyerLogFilter] = useState('all');
  const [sellerLogFilter, setSellerLogFilter] = useState('all');
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

      const [purchasesResult, salesResult, paymentsResult] = await Promise.all([
        applyRange(
          // select('*') so this keeps working whether or not migration 002
          // (purchase_group_id / purchase_number) has been applied.
          supabase
            .from('purchases')
            .select('*')
            .eq('user_id', user.id)
        ),
        applyRange(
          supabase
            .from('sales')
            .select('id, date, buyer_id, invoice_number, amount_received, status, created_at')
            .eq('user_id', user.id)
        ),
        applyRange(
          supabase
            .from('payments')
            .select('id, date, direction, party_type, party_id, amount, payment_type, created_at')
            .eq('user_id', user.id)
        ),
      ]);

      if (purchasesResult.error) throw purchasesResult.error;
      if (salesResult.error) throw salesResult.error;
      if (paymentsResult.error) throw paymentsResult.error;

      const purchases = purchasesResult.data || [];
      const sales = salesResult.data || [];
      const payments = paymentsResult.data || [];
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

      // Fetch the full directories, not just parties touched by this range —
      // otherwise the filter dropdowns hide everyone who happened to be quiet.
      const [sellersResult, buyersResult, productsResult, categoriesResult] = await Promise.all([
        supabase.from('sellers').select('id, name, store_name, status').eq('user_id', user.id),
        supabase.from('buyers').select('id, name, store_name, status').eq('user_id', user.id),
        supabase.from('products').select('*').eq('user_id', user.id),
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

      // Items bought together in one purchase share a purchase_group_id, so they
      // collapse into a single report row instead of one row per costing batch.
      // Rows saved before migration 002 have no group id and stay standalone.
      const purchaseGroupMap = purchases.reduce((map, row) => {
        const groupKey = row.purchase_group_id || row.id;
        if (!map[groupKey]) map[groupKey] = [];
        map[groupKey].push(row);
        return map;
      }, {});

      const purchaseRows = Object.entries(purchaseGroupMap).map(([groupKey, batches]) => {
        const first = batches[0];
        const seller = sellerMap[first.seller_id];
        const activeBatches = batches.filter(batch => batch.status !== 'voided');
        const counted = activeBatches.length ? activeBatches : batches;

        const total = counted.reduce((sum, batch) => sum + Number(batch.total_cost || 0), 0);
        const paid = counted.reduce((sum, batch) => sum + Number(batch.amount_paid || 0), 0);
        const balance = total - paid;

        const productNames = [...new Set(
          batches.map(batch => productMap[batch.product_id]?.name).filter(Boolean),
        )].join(', ') || 'Unknown product';
        const quantityByProduct = batches
          .map((batch) => {
            const productName = productMap[batch.product_id]?.name || 'Unknown product';
            return `${productName}: ${Number(batch.quantity || 0).toFixed(3)}`;
          })
          .join(', ');

        return {
          id: first.id,
          key: `purchase-${groupKey}`,
          date: first.date,
          createdAt: first.created_at || '',
          type: 'Purchase',
          partyId: first.seller_id,
          party: partyLabel(seller, 'Unknown seller'),
          reference: first.purchase_number || '',
          products: productNames,
          quantity: batches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0),
          quantityText: quantityByProduct || '-',
          // A single-item purchase has one meaningful rate; a mixed one does not.
          rate: batches.length === 1 ? Number(first.buying_rate || 0) : null,
          total,
          paid,
          status: activeBatches.length ? 'active' : 'voided',
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
          createdAt: row.created_at || '',
          type: 'Sale',
          partyId: row.buyer_id,
          party: partyLabel(buyer, 'Unknown buyer'),
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

      // Product-wise log: one line per product movement, purchases and sale lines
      // side by side, so a product's whole history reads in one place.
      const saleMap = Object.fromEntries(sales.map(row => [row.id, row]));

      const productPurchaseRows = purchases.map((row) => {
        const seller = sellerMap[row.seller_id];
        const product = productMap[row.product_id];
        const total = Number(row.total_cost || 0);

        return {
          key: `product-purchase-${row.id}`,
          date: row.date,
          createdAt: row.created_at || '',
          type: 'Purchase',
          productId: row.product_id,
          productName: product?.name || 'Unknown product',
          party: partyLabel(seller, 'Unknown seller'),
          quantity: Number(row.quantity || 0),
          rate: Number(row.buying_rate || 0),
          total,
          cost: total,
          profit: null,
          status: row.status,
        };
      });

      const productSaleRows = lineItems.map((line) => {
        const sale = saleMap[line.sale_id];
        const buyer = sale ? buyerMap[sale.buyer_id] : null;
        const product = productMap[line.product_id];
        const total = Number(line.line_total || 0);
        const cost = Number(costMap[line.id] || 0);

        return {
          key: `product-sale-${line.id}`,
          date: sale?.date || '',
          createdAt: sale?.created_at || '',
          type: 'Sale',
          productId: line.product_id,
          productName: product?.name || 'Unknown product',
          party: partyLabel(buyer, 'Unknown buyer'),
          quantity: Number(line.quantity || 0),
          rate: Number(line.sale_rate || 0),
          total,
          cost,
          profit: total - cost,
          status: sale?.status || 'active',
        };
      });

      const productLog = [...productPurchaseRows, ...productSaleRows].sort(byRecentFirst);

      const paymentRows = payments.map(row => {
        const party = row.party_type === 'seller'
          ? sellerMap[row.party_id]
          : buyerMap[row.party_id];
        const isToSeller = row.direction === 'to_seller';

        return {
          id: row.id,
          key: `payment-${row.id}`,
          date: row.date,
          createdAt: row.created_at || '',
          type: 'Payment',
          party: partyLabel(party, 'Unknown party'),
          products: '—',
          quantity: null,
          rate: null,
          total: Number(row.amount || 0),
          paid: Number(row.amount || 0),
          status: 'active',
          balance: 0,
          direction: isToSeller ? 'Paid Out' : 'Received',
          profit: null,
          cost: null,
        };
      });

      // Party logs need a starting point: in date-range mode the running balance
      // must open with whatever was already owed before the range began,
      // otherwise every party looks like they started from zero on the From date.
      const openingBuyerMap = {};
      const openingSellerMap = {};

      if (rangeMode === 'date') {
        const [priorSalesResult, priorPurchasesResult, priorPaymentsResult] = await Promise.all([
          supabase.from('sales').select('id, buyer_id, amount_received, status').eq('user_id', user.id).lt('date', fromDate),
          supabase.from('purchases').select('seller_id, total_cost, amount_paid, status').eq('user_id', user.id).lt('date', fromDate),
          supabase.from('payments').select('party_type, party_id, amount').eq('user_id', user.id).lt('date', fromDate),
        ]);

        if (priorSalesResult.error) throw priorSalesResult.error;
        if (priorPurchasesResult.error) throw priorPurchasesResult.error;
        if (priorPaymentsResult.error) throw priorPaymentsResult.error;

        const priorSales = priorSalesResult.data || [];
        const priorSaleIds = priorSales.map(row => row.id);
        const priorLinesResult = priorSaleIds.length
          ? await supabase.from('sale_line_items').select('sale_id, line_total').in('sale_id', priorSaleIds)
          : { data: [], error: null };

        if (priorLinesResult.error) throw priorLinesResult.error;

        const priorSaleValue = (priorLinesResult.data || []).reduce((map, line) => {
          map[line.sale_id] = (map[line.sale_id] || 0) + Number(line.line_total || 0);
          return map;
        }, {});

        priorSales.forEach((sale) => {
          if (sale.status === 'voided') return;
          const value = priorSaleValue[sale.id] || 0;
          openingBuyerMap[sale.buyer_id] = (openingBuyerMap[sale.buyer_id] || 0)
            + value - Number(sale.amount_received || 0);
        });

        (priorPurchasesResult.data || []).forEach((purchase) => {
          if (purchase.status === 'voided') return;
          openingSellerMap[purchase.seller_id] = (openingSellerMap[purchase.seller_id] || 0)
            + Number(purchase.total_cost || 0) - Number(purchase.amount_paid || 0);
        });

        (priorPaymentsResult.data || []).forEach((payment) => {
          const map = payment.party_type === 'buyer' ? openingBuyerMap : openingSellerMap;
          map[payment.party_id] = (map[payment.party_id] || 0) - Number(payment.amount || 0);
        });
      }

      // The running balance has to accumulate oldest-to-newest, but the table
      // reads newest-first — so compute ascending, then reverse for display.
      const withRunningBalance = (rows, openingMap) => {
        const acc = { ...openingMap };
        return [...rows]
          .sort(byOldestFirst)
          .map((row) => {
            const delta = row.status === 'voided' ? 0 : (row.billed - row.settled);
            acc[row.partyId] = (acc[row.partyId] || 0) + delta;
            return { ...row, balance: acc[row.partyId], opening: openingMap[row.partyId] || 0 };
          })
          .reverse();
      };

      const buyerLog = withRunningBalance([
        ...saleRows.map(row => ({
          key: `buyer-${row.key}`,
          date: row.date,
          partyId: row.partyId,
          partyName: row.party,
          type: 'Sale',
          reference: row.invoice || '-',
          details: row.products,
          billed: row.total,
          settled: row.paid,
          status: row.status,
          saleId: row.saleId,
        })),
        ...payments.filter(row => row.party_type === 'buyer').map(row => ({
          key: `buyer-payment-${row.id}`,
          date: row.date,
          partyId: row.party_id,
          partyName: partyLabel(buyerMap[row.party_id], 'Unknown buyer'),
          type: 'Payment',
          reference: '-',
          details: 'Payment received',
          billed: 0,
          settled: Number(row.amount || 0),
          status: 'active',
          saleId: null,
        })),
      ], openingBuyerMap);

      const sellerLog = withRunningBalance([
        ...purchaseRows.map(row => ({
          key: `seller-${row.key}`,
          date: row.date,
          partyId: row.partyId,
          partyName: row.party,
          type: 'Purchase',
          reference: row.reference || '-',
          details: row.products,
          billed: row.total,
          settled: row.paid,
          status: row.status,
          saleId: null,
        })),
        ...payments.filter(row => row.party_type === 'seller').map(row => ({
          key: `seller-payment-${row.id}`,
          date: row.date,
          partyId: row.party_id,
          partyName: partyLabel(sellerMap[row.party_id], 'Unknown seller'),
          type: 'Payment',
          reference: '-',
          details: 'Payment made',
          billed: 0,
          settled: Number(row.amount || 0),
          status: 'active',
          saleId: null,
        })),
      ], openingSellerMap);

      // Every active party is listed, plus any archived one that still has
      // activity in view (so their history stays reachable).
      const toOptions = (all, usedIds, labelFor) => all
        .filter(item => item.status === 'active' || usedIds.has(item.id))
        .map(item => ({ id: item.id, name: labelFor(item) }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const usedBuyerIds = new Set(buyerLog.map(row => row.partyId));
      const usedSellerIds = new Set(sellerLog.map(row => row.partyId));
      const usedProductIds = new Set(productLog.map(row => row.productId));

      const combinedTransactions = [...purchaseRows, ...saleRows, ...paymentRows].sort(byRecentFirst);

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
      setProfitRows([...saleRows].sort(byRecentFirst));
      setCategories(categoriesResult.data || []);
      setCategoryRows(categoryProfitRows);
      setProductLogRows(productLog);
      setProductOptions(toOptions(productsResult.data || [], usedProductIds, product => product.name));
      setBuyerLogRows(buyerLog);
      setSellerLogRows(sellerLog);
      setBuyerOptions(toOptions(buyersResult.data || [], usedBuyerIds, party => partyLabel(party, 'Unknown')));
      setSellerOptions(toOptions(sellersResult.data || [], usedSellerIds, party => partyLabel(party, 'Unknown')));
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

  const filteredProductRows = useMemo(() => productLogRows.filter((row) => {
    if (productFilter !== 'all' && row.productId !== productFilter) return false;
    if (productTypeFilter === 'purchase' && row.type !== 'Purchase') return false;
    if (productTypeFilter === 'sale' && row.type !== 'Sale') return false;
    return true;
  }), [productLogRows, productFilter, productTypeFilter]);

  // Voided rows stay visible in the log but never count toward the totals.
  const productSummary = useMemo(() => filteredProductRows.reduce((acc, row) => {
    if (row.status === 'voided') return acc;
    if (row.type === 'Purchase') {
      acc.qtyPurchased += row.quantity;
      acc.purchaseValue += row.total;
    } else {
      acc.qtySold += row.quantity;
      acc.saleValue += row.total;
      acc.costOfGoods += row.cost;
      acc.profit += Number(row.profit || 0);
    }
    return acc;
  }, {
    qtyPurchased: 0,
    purchaseValue: 0,
    qtySold: 0,
    saleValue: 0,
    costOfGoods: 0,
    profit: 0,
  }), [filteredProductRows]);

  const rangeLabel = rangeMode === 'date' ? `${fromDate}-to-${toDate}` : 'whole';

  const productFileName = () => {
    const productPart = productFilter === 'all'
      ? 'all-products'
      : (productOptions.find(p => p.id === productFilter)?.name || 'product')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
    return `product-log-${productPart}-${productTypeFilter}-${rangeLabel}`;
  };

  const downloadCsv = (fileName, header, rows) => {
    const csv = [header, ...rows]
      .map(cols => cols.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadProductCsv = () => {
    const header = ['Date', 'Type', 'Product', 'Party', 'Quantity', 'Rate', 'Total', 'Cost of Goods', 'Profit', 'Status'];
    const rows = filteredProductRows.map(row => ([
      row.date,
      row.type,
      row.productName,
      row.party,
      row.quantity.toFixed(3),
      row.rate.toFixed(2),
      row.total.toFixed(2),
      row.type === 'Sale' ? row.cost.toFixed(2) : '',
      row.profit === null ? '' : Number(row.profit).toFixed(2),
      row.status === 'voided' ? 'Voided' : 'Active',
    ]));

    rows.push([]);
    rows.push(['Qty Purchased', productSummary.qtyPurchased.toFixed(3)]);
    rows.push(['Purchase Value', productSummary.purchaseValue.toFixed(2)]);
    rows.push(['Qty Sold', productSummary.qtySold.toFixed(3)]);
    rows.push(['Sale Value', productSummary.saleValue.toFixed(2)]);
    rows.push(['Cost of Goods', productSummary.costOfGoods.toFixed(2)]);
    rows.push(['Profit', productSummary.profit.toFixed(2)]);

    downloadCsv(productFileName(), header, rows);
  };

  const downloadProductPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const columns = [
      { label: 'Date', x: 14 },
      { label: 'Type', x: 40 },
      { label: 'Product', x: 62 },
      { label: 'Party', x: 105 },
      { label: 'Qty', x: 150 },
      { label: 'Rate', x: 172 },
      { label: 'Total', x: 196 },
      { label: 'Cost', x: 222 },
      { label: 'Profit', x: 248 },
      { label: 'Status', x: 274 },
    ];
    let y = 14;

    const drawHeader = () => {
      doc.setFontSize(9);
      columns.forEach(col => doc.text(col.label, col.x, y));
      y += 2;
      doc.line(14, y, 290, y);
      y += 6;
    };

    doc.setFontSize(14);
    doc.text('Product-wise Log', 14, y);
    y += 7;
    doc.setFontSize(10);
    const productLabel = productFilter === 'all'
      ? 'All products'
      : (productOptions.find(p => p.id === productFilter)?.name || 'Product');
    const typeLabel = productTypeFilter === 'all'
      ? 'Purchases + Sales'
      : productTypeFilter === 'purchase' ? 'Purchases only' : 'Sales only';
    doc.text(
      `${productLabel} · ${typeLabel} · ${rangeMode === 'date' ? `${fromDate} to ${toDate}` : 'Whole data'}`,
      14,
      y,
    );
    y += 8;
    drawHeader();

    filteredProductRows.forEach((row) => {
      if (y > 190) {
        doc.addPage('a4', 'landscape');
        y = 14;
        drawHeader();
      }
      doc.setFontSize(9);
      doc.text(String(row.date), 14, y);
      doc.text(row.type, 40, y);
      doc.text(row.productName.slice(0, 22), 62, y);
      doc.text(row.party.slice(0, 22), 105, y);
      doc.text(row.quantity.toFixed(3), 150, y);
      doc.text(row.rate.toFixed(2), 172, y);
      doc.text(row.total.toFixed(2), 196, y);
      doc.text(row.type === 'Sale' ? row.cost.toFixed(2) : '-', 222, y);
      doc.text(row.profit === null ? '-' : Number(row.profit).toFixed(2), 248, y);
      doc.text(row.status === 'voided' ? 'Voided' : 'Active', 274, y);
      y += 6;
    });

    if (y > 170) {
      doc.addPage('a4', 'landscape');
      y = 14;
    }
    y += 4;
    doc.line(14, y, 290, y);
    y += 7;
    doc.setFontSize(10);
    doc.text(
      `Qty Purchased: ${productSummary.qtyPurchased.toFixed(3)}   Purchase Value: ${productSummary.purchaseValue.toFixed(2)}   Qty Sold: ${productSummary.qtySold.toFixed(3)}`,
      14,
      y,
    );
    y += 6;
    doc.text(
      `Sale Value: ${productSummary.saleValue.toFixed(2)}   Cost of Goods: ${productSummary.costOfGoods.toFixed(2)}   Profit: ${productSummary.profit.toFixed(2)}`,
      14,
      y,
    );

    doc.save(`${productFileName()}.pdf`);
  };

  // Buyer and seller logs are the same shape; only the labels differ.
  const partyConfig = {
    buyer: {
      title: 'Buyer-wise Log',
      partyWord: 'Buyer',
      billedLabel: 'Billed',
      settledLabel: 'Received',
      rows: buyerLogRows,
      options: buyerOptions,
      filter: buyerLogFilter,
      setFilter: setBuyerLogFilter,
      fileStem: 'buyer-log',
      dueWord: 'Owes me',
      advanceWord: 'Advance held',
    },
    seller: {
      title: 'Seller-wise Log',
      partyWord: 'Seller',
      billedLabel: 'Billed',
      settledLabel: 'Paid',
      rows: sellerLogRows,
      options: sellerOptions,
      filter: sellerLogFilter,
      setFilter: setSellerLogFilter,
      fileStem: 'seller-log',
      dueWord: 'I owe',
      advanceWord: 'Advance paid',
    },
  };

  const filteredBuyerRows = useMemo(
    () => (buyerLogFilter === 'all' ? buyerLogRows : buyerLogRows.filter(row => row.partyId === buyerLogFilter)),
    [buyerLogRows, buyerLogFilter],
  );

  const filteredSellerRows = useMemo(
    () => (sellerLogFilter === 'all' ? sellerLogRows : sellerLogRows.filter(row => row.partyId === sellerLogFilter)),
    [sellerLogRows, sellerLogFilter],
  );

  const partyRowsFor = (kind) => (kind === 'buyer' ? filteredBuyerRows : filteredSellerRows);

  const partyTotals = (rows) => rows.reduce((acc, row) => {
    if (row.status === 'voided') return acc;
    acc.billed += row.billed;
    acc.settled += row.settled;
    return acc;
  }, { billed: 0, settled: 0 });

  // Closing balance = the last running balance of each party in view, so the
  // net across several parties never double-counts a party's own history.
  const partyNet = (rows) => {
    // Rows are newest-first, so the first row seen for a party carries that
    // party's closing balance.
    const closingByParty = {};
    rows.forEach((row) => {
      if (!(row.partyId in closingByParty)) closingByParty[row.partyId] = row.balance;
    });
    return Object.values(closingByParty).reduce((sum, value) => sum + Number(value || 0), 0);
  };

  const balanceText = (value, config) => {
    const amount = Number(value || 0);
    if (Math.abs(amount) < 0.005) return 'Settled';
    return `${amount > 0 ? config.dueWord : config.advanceWord}: ${formatCurrency(Math.abs(amount))}`;
  };

  const partyFileName = (kind) => {
    const config = partyConfig[kind];
    const partyPart = config.filter === 'all'
      ? `all-${kind}s`
      : (config.options.find(p => p.id === config.filter)?.name || kind)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
    return `${config.fileStem}-${partyPart}-${rangeLabel}`;
  };

  const downloadPartyCsv = (kind) => {
    const config = partyConfig[kind];
    const rows = partyRowsFor(kind);
    const totals = partyTotals(rows);

    const header = [
      'Date',
      config.partyWord,
      'Type',
      'Reference',
      'Details',
      config.billedLabel,
      config.settledLabel,
      'Balance After',
      'Balance Type',
      'Status',
    ];

    const body = rows.map(row => ([
      row.date,
      row.partyName,
      row.type,
      row.reference,
      row.details,
      row.billed.toFixed(2),
      row.settled.toFixed(2),
      Math.abs(Number(row.balance || 0)).toFixed(2),
      Math.abs(Number(row.balance || 0)) < 0.005 ? 'Settled' : (row.balance > 0 ? config.dueWord : config.advanceWord),
      row.status === 'voided' ? 'Voided' : 'Active',
    ]));

    body.push([]);
    body.push([`Total ${config.billedLabel}`, totals.billed.toFixed(2)]);
    body.push([`Total ${config.settledLabel}`, totals.settled.toFixed(2)]);
    body.push(['Closing Balance', balanceText(partyNet(rows), config)]);

    downloadCsv(partyFileName(kind), header, body);
  };

  const downloadPartyPdf = (kind) => {
    const config = partyConfig[kind];
    const rows = partyRowsFor(kind);
    const totals = partyTotals(rows);
    const doc = new jsPDF({ orientation: 'landscape' });
    const columns = [
      { label: 'Date', x: 14 },
      { label: config.partyWord, x: 40 },
      { label: 'Type', x: 85 },
      { label: 'Reference', x: 108 },
      { label: 'Details', x: 140 },
      { label: config.billedLabel, x: 192 },
      { label: config.settledLabel, x: 218 },
      { label: 'Balance', x: 244 },
      { label: 'Status', x: 274 },
    ];
    let y = 14;

    const drawHeader = () => {
      doc.setFontSize(9);
      columns.forEach(col => doc.text(col.label, col.x, y));
      y += 2;
      doc.line(14, y, 290, y);
      y += 6;
    };

    doc.setFontSize(14);
    doc.text(config.title, 14, y);
    y += 7;
    doc.setFontSize(10);
    const partyName = config.filter === 'all'
      ? `All ${kind}s`
      : (config.options.find(p => p.id === config.filter)?.name || config.partyWord);
    doc.text(
      `${partyName} · ${rangeMode === 'date' ? `${fromDate} to ${toDate}` : 'Whole data'}`,
      14,
      y,
    );
    y += 8;
    drawHeader();

    rows.forEach((row) => {
      if (y > 190) {
        doc.addPage('a4', 'landscape');
        y = 14;
        drawHeader();
      }
      doc.setFontSize(9);
      doc.text(String(row.date), 14, y);
      doc.text(row.partyName.slice(0, 22), 40, y);
      doc.text(row.type, 85, y);
      doc.text(String(row.reference).slice(0, 16), 108, y);
      doc.text(String(row.details).slice(0, 26), 140, y);
      doc.text(row.billed.toFixed(2), 192, y);
      doc.text(row.settled.toFixed(2), 218, y);
      doc.text(Math.abs(Number(row.balance || 0)).toFixed(2), 244, y);
      doc.text(row.status === 'voided' ? 'Voided' : 'Active', 274, y);
      y += 6;
    });

    if (y > 175) {
      doc.addPage('a4', 'landscape');
      y = 14;
    }
    y += 4;
    doc.line(14, y, 290, y);
    y += 7;
    doc.setFontSize(10);
    doc.text(`Total ${config.billedLabel}: ${totals.billed.toFixed(2)}`, 14, y);
    doc.text(`Total ${config.settledLabel}: ${totals.settled.toFixed(2)}`, 90, y);
    doc.text(`Closing: ${balanceText(partyNet(rows), config)}`, 170, y);

    doc.save(`${partyFileName(kind)}.pdf`);
  };

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

    downloadCsv(`category-profit-${rangeLabel}`, header, rows);
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

  const renderPartyLog = (kind) => {
    const config = partyConfig[kind];
    const rows = partyRowsFor(kind);
    const totals = partyTotals(rows);
    const showPartyColumn = config.filter === 'all';
    const openingBalance = config.filter === 'all' ? null : (rows[0]?.opening ?? 0);

    return (
      <section className="report-section">
        <div className="report-section-header">
          <h2>{config.title}</h2>
          <div className="category-report-actions">
            <button type="button" className="report-action-btn" onClick={() => downloadPartyCsv(kind)}>Download CSV (Excel)</button>
            <button type="button" className="report-action-btn" onClick={() => downloadPartyPdf(kind)}>Download PDF</button>
          </div>
        </div>

        <div className="category-filter-row product-filter-row">
          <label>
            <span>{config.partyWord}</span>
            <SearchableSelect
              value={config.filter}
              onChange={config.setFilter}
              placeholder={`Search ${kind}s...`}
              options={[
                { value: 'all', label: `All ${kind}s` },
                ...config.options.map(party => ({ value: party.id, label: party.name })),
              ]}
            />
          </label>
        </div>

        <div className="report-summary-grid product-summary-grid">
          <div className="summary-card">
            <span className="summary-label">Entries</span>
            <strong>{rows.length}</strong>
          </div>
          <div className="summary-card">
            <span className="summary-label">Total {config.billedLabel}</span>
            <strong>{formatCurrency(totals.billed)}</strong>
          </div>
          <div className="summary-card">
            <span className="summary-label">Total {config.settledLabel}</span>
            <strong>{formatCurrency(totals.settled)}</strong>
          </div>
          <div className="summary-card">
            <span className="summary-label">Closing Balance</span>
            <strong>{balanceText(partyNet(rows), config)}</strong>
          </div>
        </div>

        {rangeMode === 'date' && config.filter !== 'all' && (
          <p className="log-opening-note">
            Opening balance on {fromDate}: <strong>{balanceText(openingBalance, config)}</strong>
            {' — '}carried in from activity before this range.
          </p>
        )}

        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Date</th>
                {showPartyColumn && <th>{config.partyWord}</th>}
                <th>Type</th>
                <th>Reference</th>
                <th>Details</th>
                <th>{config.billedLabel}</th>
                <th>{config.settledLabel}</th>
                <th>Balance After</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={showPartyColumn ? 9 : 8} className="empty-row">No activity in this range.</td></tr>
              ) : rows.map(row => (
                <tr key={row.key}>
                  <td>{row.date}</td>
                  {showPartyColumn && <td>{row.partyName}</td>}
                  <td><span className={`type-pill ${row.type.toLowerCase()}`}>{row.type}</span></td>
                  <td>{row.reference}</td>
                  <td>{row.details}</td>
                  <td>{row.billed ? formatCurrency(row.billed) : '-'}</td>
                  <td>{row.settled ? formatCurrency(row.settled) : '-'}</td>
                  <td>
                    <span className={`balance-pill ${Math.abs(Number(row.balance || 0)) < 0.005 ? 'settled' : (row.balance > 0 ? 'due' : 'advance')}`}>
                      {balanceText(row.balance, config)}
                    </span>
                  </td>
                  <td>
                    <span className={`balance-pill ${row.status === 'voided' ? 'voided' : 'settled'}`}>
                      {row.status === 'voided' ? 'Voided' : 'Active'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

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
        <button type="button" className={`report-tab ${activeTab === 'product' ? 'active' : ''}`} onClick={() => setActiveTab('product')}>Product-wise Log</button>
        <button type="button" className={`report-tab ${activeTab === 'buyer' ? 'active' : ''}`} onClick={() => setActiveTab('buyer')}>Buyer-wise Log</button>
        <button type="button" className={`report-tab ${activeTab === 'seller' ? 'active' : ''}`} onClick={() => setActiveTab('seller')}>Seller-wise Log</button>
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

      {(activeTab === 'buyer' || activeTab === 'seller') && renderPartyLog(activeTab)}

      {activeTab === 'product' && (
        <section className="report-section">
          <div className="report-section-header">
            <h2>Product-wise Log</h2>
            <div className="category-report-actions">
              <button type="button" className="report-action-btn" onClick={downloadProductCsv}>Download CSV (Excel)</button>
              <button type="button" className="report-action-btn" onClick={downloadProductPdf}>Download PDF</button>
            </div>
          </div>

          <div className="category-filter-row product-filter-row">
            <label>
              <span>Product</span>
              <SearchableSelect
                value={productFilter}
                onChange={setProductFilter}
                placeholder="Search products..."
                options={[
                  { value: 'all', label: 'All products' },
                  ...productOptions.map(product => ({ value: product.id, label: product.name })),
                ]}
              />
            </label>
            <label>
              <span>Show</span>
              <select value={productTypeFilter} onChange={(e) => setProductTypeFilter(e.target.value)}>
                <option value="all">Purchases + Sales</option>
                <option value="purchase">Purchases only</option>
                <option value="sale">Sales only</option>
              </select>
            </label>
          </div>

          <div className="report-summary-grid product-summary-grid">
            <div className="summary-card">
              <span className="summary-label">Qty Purchased</span>
              <strong>{productSummary.qtyPurchased.toFixed(3)}</strong>
            </div>
            <div className="summary-card">
              <span className="summary-label">Purchase Value</span>
              <strong>{formatCurrency(productSummary.purchaseValue)}</strong>
            </div>
            <div className="summary-card">
              <span className="summary-label">Qty Sold</span>
              <strong>{productSummary.qtySold.toFixed(3)}</strong>
            </div>
            <div className="summary-card">
              <span className="summary-label">Sale Value</span>
              <strong>{formatCurrency(productSummary.saleValue)}</strong>
            </div>
            <div className="summary-card">
              <span className="summary-label">Cost of Goods</span>
              <strong>{formatCurrency(productSummary.costOfGoods)}</strong>
            </div>
            <div className="summary-card">
              <span className="summary-label">Profit</span>
              <strong>{formatCurrency(productSummary.profit)}</strong>
            </div>
          </div>

          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Product</th>
                  <th>Party</th>
                  <th>Quantity</th>
                  <th>Rate</th>
                  <th>Total</th>
                  <th>Cost of Goods</th>
                  <th>Profit</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredProductRows.length === 0 ? (
                  <tr><td colSpan="10" className="empty-row">No product activity in this range.</td></tr>
                ) : filteredProductRows.map(row => (
                  <tr key={row.key}>
                    <td>{row.date}</td>
                    <td><span className={`type-pill ${row.type.toLowerCase()}`}>{row.type}</span></td>
                    <td>{row.productName}</td>
                    <td>{row.party}</td>
                    <td>{row.quantity.toFixed(3)}</td>
                    <td>{formatCurrency(row.rate)}</td>
                    <td>{formatCurrency(row.total)}</td>
                    <td>{row.type === 'Sale' ? formatCurrency(row.cost) : '-'}</td>
                    <td>{row.profit === null ? '-' : formatCurrency(row.profit)}</td>
                    <td>
                      <span className={`balance-pill ${row.status === 'voided' ? 'voided' : 'settled'}`}>
                        {row.status === 'voided' ? 'Voided' : 'Active'}
                      </span>
                    </td>
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