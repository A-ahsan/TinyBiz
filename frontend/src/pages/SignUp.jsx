import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import './Auth.css';

const SignUp = () => {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    name: '',
    businessName: '',
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (form.password !== form.confirmPassword) {
        throw new Error('Passwords do not match');
      }

      await signUp(form.email, form.password, form.name, form.businessName);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>Create Account</h1>
        <p className="auth-subtitle">Join TinyBiz to start managing your business</p>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Full Name *</label>
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              required
              placeholder="Your name"
            />
          </div>

          <div className="form-group">
            <label>Business Name *</label>
            <input
              type="text"
              name="businessName"
              value={form.businessName}
              onChange={handleChange}
              required
              placeholder="Your business name"
            />
          </div>

          <div className="form-group">
            <label>Email *</label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              required
              placeholder="your@email.com"
            />
          </div>

          <div className="form-group">
            <label>Password *</label>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              required
              placeholder="At least 6 characters"
            />
          </div>

          <div className="form-group">
            <label>Confirm Password *</label>
            <input
              type="password"
              name="confirmPassword"
              value={form.confirmPassword}
              onChange={handleChange}
              required
              placeholder="Confirm your password"
            />
          </div>

          <button type="submit" disabled={loading} className="auth-btn">
            {loading ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>

        <p className="auth-link">
          Already have an account? <a href="/signin">Sign In</a>
        </p>
      </div>
    </div>
  );
};

export default SignUp;
