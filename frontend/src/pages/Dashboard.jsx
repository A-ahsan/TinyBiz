import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../utils/helpers';
import { TrendingUp, DollarSign, Users, ShoppingCart } from 'lucide-react';
import './Dashboard.css';

const Dashboard = () => {
  const [metrics, setMetrics] = useState({
    totalDues: 0,
    totalAdvances: 0,
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

      const [{ data: sellerBalances }, { data: buyerBalances }, { data: monthlySales }] = await Promise.all([
        supabase.from('seller_balances').select('seller_id, running_balance').eq('user_id', user.id),
        supabase.from('buyer_balances').select('buyer_id, running_balance').eq('user_id', user.id),
        supabase
          .from('sales')
          .select('id')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .gte('date', startOfMonth)
          .lte('date', currentDate),
      ]);

      let totalDues = 0;
      let totalAdvances = 0;
      let totalSales = 0;
      let totalProfit = 0;

      const addBalance = (balance) => {
        if (balance > 0) totalDues += balance;
        else totalAdvances += Math.abs(balance);
      };

      if (sellerBalances) sellerBalances.forEach((row) => addBalance(Number(row.running_balance || 0)));
      if (buyerBalances) buyerBalances.forEach((row) => addBalance(Number(row.running_balance || 0)));

      const saleIds = (monthlySales || []).map((sale) => sale.id);
      if (saleIds.length > 0) {
        const [saleLineItemsResult] = await Promise.all([
          supabase
            .from('sale_line_items')
            .select('id, sale_id, line_total')
            .in('sale_id', saleIds),
        ]);

        const saleLineItems = saleLineItemsResult.data || [];
        const lineItemIds = saleLineItems.map((lineItem) => lineItem.id);

        totalSales = saleLineItems.reduce((sum, lineItem) => sum + Number(lineItem.line_total || 0), 0);

        if (lineItemIds.length > 0) {
          const { data: allocations } = await supabase
            .from('sale_allocations')
            .select('sale_line_item_id, cost_allocated')
            .in('sale_line_item_id', lineItemIds);

          const totalCost = (allocations || []).reduce(
            (sum, allocation) => sum + Number(allocation.cost_allocated || 0),
            0,
          );

          totalProfit = totalSales - totalCost;
        }
      }

      setMetrics({
        totalDues,
        totalAdvances,
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
            <DollarSign size={28} />
          </div>
          <div className="metric-content">
            <p className="metric-label">Total Due</p>
            <h3 className="metric-value">{formatCurrency(metrics.totalDues)}</h3>
            <p className="metric-description">Money owed</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon advance">
            <TrendingUp size={28} />
          </div>
          <div className="metric-content">
            <p className="metric-label">Total Advance</p>
            <h3 className="metric-value">{formatCurrency(metrics.totalAdvances)}</h3>
            <p className="metric-description">Prepaid/Credit</p>
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
            <a href="/products" className="action-button">Add Products</a>
            <a href="/sellers" className="action-button">Add Sellers</a>
            <a href="/buyers" className="action-button">Add Buyers</a>
            <a href="/purchase" className="action-button primary">Record Purchase</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;