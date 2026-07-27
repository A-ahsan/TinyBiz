import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { LogOut, BarChart3, ShoppingCart, Users, FileText, TrendingUp, Home, Wallet } from 'lucide-react';
import './Sidebar.css';

const formatClockDate = (value) => value.toLocaleDateString('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const formatClockTime = (value) => value.toLocaleTimeString('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

const Sidebar = () => {
  const { signOut, profile } = useAuth();
  const location = useLocation();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const isActive = (path) => location.pathname === path;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>{profile?.business_name || 'TinyBiz'}</h1>
        <p className="user-name">{profile?.name || 'User'}</p>
        <div className="sidebar-clock">
          <span className="clock-date">{formatClockDate(now)}</span>
          <span className="clock-time">{formatClockTime(now)}</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <Link to="/dashboard" className={`nav-link ${isActive('/dashboard') ? 'active' : ''}`}>
          <Home size={20} />
          <span>Dashboard</span>
        </Link>

        <div className="nav-section">
          <p className="nav-section-title">Operations</p>
          <Link to="/purchase" className={`nav-link ${isActive('/purchase') ? 'active' : ''}`}>
            <ShoppingCart size={20} />
            <span>Record Purchase</span>
          </Link>
          <Link to="/sale" className={`nav-link ${isActive('/sale') ? 'active' : ''}`}>
            <FileText size={20} />
            <span>Record Sale</span>
          </Link>
          <Link to="/payment" className={`nav-link ${isActive('/payment') ? 'active' : ''}`}>
            <Wallet size={20} />
            <span>Record Payment</span>
          </Link>
        </div>

        <div className="nav-section">
          <p className="nav-section-title">Directory</p>
          <Link to="/products" className={`nav-link ${isActive('/products') ? 'active' : ''}`}>
            <TrendingUp size={20} />
            <span>Products</span>
          </Link>
          <Link to="/sellers" className={`nav-link ${isActive('/sellers') ? 'active' : ''}`}>
            <Users size={20} />
            <span>Sellers</span>
          </Link>
          <Link to="/buyers" className={`nav-link ${isActive('/buyers') ? 'active' : ''}`}>
            <Users size={20} />
            <span>Buyers</span>
          </Link>
        </div>

        <div className="nav-section">
          <p className="nav-section-title">Reports</p>
          <Link to="/reports" className={`nav-link ${isActive('/reports') ? 'active' : ''}`}>
            <BarChart3 size={20} />
            <span>All Reports</span>
          </Link>
        </div>
      </nav>

      <div className="sidebar-footer">
        <button onClick={handleLogout} className="logout-btn">
          <LogOut size={20} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
