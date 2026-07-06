import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import Sidebar from './components/Sidebar';
import SignUp from './pages/SignUp';
import SignIn from './pages/SignIn';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Sellers from './pages/Sellers';
import Buyers from './pages/Buyers';
import RecordPurchase from './pages/RecordPurchase';
import RecordSale from './pages/RecordSale';
import RecordPayment from './pages/RecordPayment';
import Invoice from './pages/Invoice';
import Reports from './pages/Reports';
import './App.css';

const AppLayout = ({ children }) => {
  return (
    <div className="app-container">
      <Sidebar />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
};

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/signin" replace />;
  }

  return <AppLayout>{children}</AppLayout>;
};

const AuthRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/signup" element={<AuthRoute><SignUp /></AuthRoute>} />
          <Route path="/signin" element={<AuthRoute><SignIn /></AuthRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
          <Route path="/sellers" element={<ProtectedRoute><Sellers /></ProtectedRoute>} />
          <Route path="/buyers" element={<ProtectedRoute><Buyers /></ProtectedRoute>} />
          <Route path="/purchase" element={<ProtectedRoute><RecordPurchase /></ProtectedRoute>} />
          <Route path="/sale" element={<ProtectedRoute><RecordSale /></ProtectedRoute>} />
          <Route path="/payment" element={<ProtectedRoute><RecordPayment /></ProtectedRoute>} />
          <Route path="/invoice/:saleId" element={<ProtectedRoute><Invoice /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;