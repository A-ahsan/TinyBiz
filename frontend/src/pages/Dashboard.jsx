import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../utils/helpers';
import { fetchAllByIds, fetchAllRows } from '../utils/supabaseFetch';
import { TrendingUp, DollarSign, Users, ShoppingCart, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import './Dashboard.css';

const Dashboard = () => {
  const [metrics, setMetrics] = useState({
    buyersOweMe: 0,
    iOweSellers: 0,
    buyerAdvances: 0,
    sellerAdvances: 0,
    totalSales: 0,
    totalProfit: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
      const currentDate = today.toISOString().slice(0, 10);

      const [sellerBalances, buyerBalances, monthlySales] = await Promise.all([
        fetchAllRows(() => supabase.from('seller_balances').select('seller_id, running_balance').eq('user_id', user.id).order('seller_id')),
        fetchAllRows(() => supabase.from('buyer_balances').select('buyer_id, running_balance').eq('user_id', user.id).order('buyer_id')),
        fetchAllRows(() => supabase
          .from('sales')
          .select('id')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .gte('date', startOfMonth)
          .lte('date', currentDate)
          .order('id')),
      ]);

      // Money owed TO you and money owed BY you are different facts and must
      // never be added together.
      let buyersOweMe = 0;
      let iOweSellers = 0;
      let buyerAdvances = 0;
      let sellerAdvances = 0;
      let totalSales = 0;
      let totalProfit = 0;

      buyerBalances.forEach((row) => {
        const balance = Number(row.running_balance || 0);
        if (balance > 0) buyersOweMe += balance;
        else buyerAdvances += Math.abs(balance);
      });

      sellerBalances.forEach((row) => {
        const balance = Number(row.running_balance || 0);
        if (balance > 0) iOweSellers += balance;
        else sellerAdvances += Math.abs(balance);
      });

      const saleLineItems = await fetchAllByIds(
        () => supabase.from('sale_line_items').select('id, sale_id, line_total').order('id'),
        'sale_id',
        monthlySales.map((sale) => sale.id),
      );

      totalSales = saleLineItems.reduce((sum, lineItem) => sum + Number(lineItem.line_total || 0), 0);

      const allocations = await fetchAllByIds(
        () => supabase.from('sale_allocations').select('sale_line_item_id, cost_allocated').order('id'),
        'sale_line_item_id',
        saleLineItems.map((lineItem) => lineItem.id),
      );

      const totalCost = allocations.reduce(
        (sum, allocation) => sum + Number(allocation.cost_allocated || 0),
        0,
      );

      totalProfit = totalSales - totalCost;

      setMetrics({
        buyersOweMe,
        iOweSellers,
        buyerAdvances,
        sellerAdvances,
        totalSales,
        totalProfit,
      });
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <p>Real-time overview of your business performance</p>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-icon due">
            <ArrowDownLeft size={28} />
          </div>
          <div className="metric-content">
            <p className="metric-label">Buyers Owe Me</p>
            <h3 className="metric-value">{formatCurrency(metrics.buyersOweMe)}</h3>
            <p className="metric-description">Receivable</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon owe">
            <ArrowUpRight size={28} />
          </div>
          <div className="metric-content">
            <p className="metric-label">I Owe Sellers</p>
            <h3 className="metric-value">{formatCurrency(metrics.iOweSellers)}</h3>
            <p className="metric-description">Payable</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon advance">
            <DollarSign size={28} />
          </div>
          <div className="metric-content">
            <p className="metric-label">Buyer Advances Held</p>
            <h3 className="metric-value">{formatCurrency(metrics.buyerAdvances)}</h3>
            <p className="metric-description">Paid to me upfront</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon advance">
            <TrendingUp size={28} />
          </div>
          <div className="metric-content">
            <p className="metric-label">Advances With Sellers</p>
            <h3 className="metric-value">{formatCurrency(metrics.sellerAdvances)}</h3>
            <p className="metric-description">I prepaid them</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon sales">
            <ShoppingCart size={28} />
          </div>
          <div className="metric-content">
            <p className="metric-label">Total Sales</p>
            <h3 className="metric-value">{formatCurrency(metrics.totalSales)}</h3>
            <p className="metric-description">This month</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon profit">
            <Users size={28} />
          </div>
          <div className="metric-content">
            <p className="metric-label">Total Profit</p>
            <h3 className="metric-value">{formatCurrency(metrics.totalProfit)}</h3>
            <p className="metric-description">This month</p>
          </div>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="welcome-card">
          <h2>Welcome to TinyBiz</h2>
          <p>
            Your wholesale trading ledger is ready. Start by adding your products, sellers, and buyers.
            Then record your purchases and sales to track inventory and profitability.
          </p>
          <div className="quick-actions">
            <Link to="/products" className="action-button">Add Products</Link>
            <Link to="/sellers" className="action-button">Add Sellers</Link>
            <Link to="/buyers" className="action-button">Add Buyers</Link>
            <Link to="/purchase" className="action-button primary">Record Purchase</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;