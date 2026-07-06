import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Trash2, Edit2, Plus, X } from 'lucide-react';
import './Products.css';

const Products = () => {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    set_rate: '',
    unit: '',
  });

  useEffect(() => {
    if (user) {
      fetchProducts();
    }
  }, [user]);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      setError('');
      const { data, error: err } = await supabase
        .from('products')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (err) throw err;
      setProducts(data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch products');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const resetForm = () => {
    setFormData({ name: '', set_rate: '', unit: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.name.trim()) {
      setError('Product name is required');
      return;
    }

    try {
      const payload = {
        user_id: user.id,
        name: formData.name.trim(),
        unit: formData.unit.trim() || null,
        set_rate: formData.set_rate ? parseFloat(formData.set_rate) : null,
      };

      if (editingId) {
        // Update
        const { error: err } = await supabase
          .from('products')
          .update(payload)
          .eq('id', editingId)
          .eq('user_id', user.id);

        if (err) throw err;
        setSuccess('Product updated successfully');
      } else {
        // Create
        const { error: err } = await supabase
          .from('products')
          .insert([payload]);

        if (err) throw err;
        setSuccess('Product added successfully');
      }

      resetForm();
      fetchProducts();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to save product');
    }
  };

  const handleEdit = (product) => {
    setFormData({
      name: product.name,
      set_rate: product.set_rate || '',
      unit: product.unit || '',
    });
    setEditingId(product.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure? This will archive the product.')) return;

    try {
      setError('');
      const { error: err } = await supabase
        .from('products')
        .update({ status: 'removed' })
        .eq('id', id)
        .eq('user_id', user.id);

      if (err) throw err;
      setSuccess('Product archived');
      fetchProducts();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to delete product');
    }
  };

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeCount = products.filter(p => p.status === 'active').length;
  const archivedCount = products.filter(p => p.status === 'removed').length;

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
          <h1>Products</h1>
          <p>Manage your product catalog and set rates</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary btn-with-icon">
          <Plus size={20} />
          Add Product
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="products-stats">
        <div className="stat">
          <span className="stat-label">Total Products</span>
          <span className="stat-value">{products.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Active</span>
          <span className="stat-value active">{activeCount}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Archived</span>
          <span className="stat-value archived">{archivedCount}</span>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={resetForm}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit Product' : 'Add New Product'}</h2>
              <button onClick={resetForm} className="modal-close">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="product-form">
              <div className="form-group">
                <label>Product Name *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="e.g., Rice, Wheat, Cement"
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Unit (Optional)</label>
                  <input
                    type="text"
                    name="unit"
                    value={formData.unit}
                    onChange={handleInputChange}
                    placeholder="e.g., kg, pcs, litre"
                  />
                </div>

                <div className="form-group">
                  <label>Set Rate (Optional)</label>
                  <input
                    type="number"
                    name="set_rate"
                    value={formData.set_rate}
                    onChange={handleInputChange}
                    placeholder="Reference rate (BDT)"
                    step="0.01"
                    min="0"
                  />
                </div>
              </div>

              <p className="form-hint">
                Note: Set Rate is optional and only used as a suggestion when creating sales.
              </p>

              <div className="form-actions">
                <button type="button" onClick={resetForm} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingId ? 'Update Product' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="products-section">
        <div className="section-header">
          <h3>All Products ({filteredProducts.length})</h3>
          <input
            type="text"
            placeholder="Search products..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>

        {filteredProducts.length === 0 ? (
          <div className="empty-state">
            <p>No products found</p>
            <button onClick={() => setShowForm(true)} className="btn-primary">
              Create your first product
            </button>
          </div>
        ) : (
          <div className="products-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Unit</th>
                  <th>Set Rate (BDT)</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map(product => (
                  <tr key={product.id} className={product.status === 'removed' ? 'archived' : ''}>
                    <td className="name-cell">{product.name}</td>
                    <td>{product.unit || '-'}</td>
                    <td>
                      {product.set_rate ? `${product.set_rate.toFixed(2)}` : '-'}
                    </td>
                    <td>
                      <span className={`status-badge ${product.status}`}>
                        {product.status === 'active' ? 'Active' : 'Archived'}
                      </span>
                    </td>
                    <td className="actions-cell">
                      {product.status === 'active' && (
                        <>
                          <button
                            onClick={() => handleEdit(product)}
                            className="action-btn edit"
                            title="Edit"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            onClick={() => handleDelete(product.id)}
                            className="action-btn delete"
                            title="Archive"
                          >
                            <Trash2 size={18} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Products;
