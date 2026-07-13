import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Trash2, Edit2, Plus, X, Check } from 'lucide-react';
import './Products.css';

const PAGE_SIZE = 20;

const formatStock = (qty, unit) => {
  const value = Number(qty || 0);
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
  return unit ? `${formatted} ${unit}` : formatted;
};

const Products = () => {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingStockId, setEditingStockId] = useState(null);
  const [stockDraft, setStockDraft] = useState('');
  const [savingStockId, setSavingStockId] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    set_rate: '',
    unit: '',
    category_id: '',
  });

  useEffect(() => {
    if (user) {
      fetchProducts();
    }
  }, [user]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, categoryFilter]);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      setError('');

      const [productsResult, categoriesResult] = await Promise.all([
        supabase
          .from('product_stock_levels')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('product_categories')
          .select('id, name, status')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('name', { ascending: true }),
      ]);

      if (productsResult.error) {
        if (productsResult.error.message?.includes('product_stock_levels')) {
          throw new Error(
            'Stock view not found. Run database/migrations/001_product_stock.sql in Supabase SQL Editor first.',
          );
        }
        throw productsResult.error;
      }
      if (categoriesResult.error) throw categoriesResult.error;

      setProducts(productsResult.data || []);
      setCategories(categoriesResult.data || []);
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
    setFormData({ name: '', set_rate: '', unit: '', category_id: '' });
    setShowAddCategory(false);
    setNewCategoryName('');
    setEditingId(null);
    setShowForm(false);
  };

  const addCategory = async () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) {
      setError('Category name is required');
      return;
    }

    try {
      setError('');
      const payload = { user_id: user.id, name: trimmed };
      const { data, error: insErr } = await supabase
        .from('product_categories')
        .insert([payload])
        .select('id, name')
        .single();

      if (insErr) throw insErr;

      setCategories(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setFormData(prev => ({ ...prev, category_id: data.id }));
      setShowAddCategory(false);
      setNewCategoryName('');
    } catch (err) {
      setError(err.message || 'Failed to add category');
    }
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
        category_id: formData.category_id || null,
      };

      if (editingId) {
        const { error: err } = await supabase
          .from('products')
          .update(payload)
          .eq('id', editingId)
          .eq('user_id', user.id);

        if (err) throw err;
        setSuccess('Product updated successfully');
      } else {
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
      category_id: product.category_id || '',
    });
    setEditingId(product.product_id);
    setShowForm(true);
  };

  const categoryNameById = (categoryId) => categories.find(c => c.id === categoryId)?.name || '-';

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

  const startStockEdit = (product) => {
    if (product.status !== 'active') return;
    setEditingStockId(product.product_id);
    setStockDraft(String(Number(product.stock_qty || 0)));
    setError('');
  };

  const cancelStockEdit = () => {
    setEditingStockId(null);
    setStockDraft('');
  };

  const saveStockEdit = async (product) => {
    const target = Number(stockDraft);
    if (Number.isNaN(target) || target < 0) {
      setError('Enter a valid stock quantity (0 or more)');
      return;
    }

    try {
      setSavingStockId(product.product_id);
      setError('');

      const { data, error: rpcErr } = await supabase.rpc('adjust_product_stock', {
        p_product_id: product.product_id,
        p_target_stock: target,
      });

      if (rpcErr) throw rpcErr;

      setProducts(prev => prev.map(row => (
        row.product_id === product.product_id
          ? { ...row, stock_qty: data ?? target }
          : row
      )));

      setSuccess(`Stock updated for ${product.name}`);
      cancelStockEdit();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to update stock');
    } finally {
      setSavingStockId(null);
    }
  };

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const categoryName = categoryNameById(product.category_id);
      const text = `${product.name} ${categoryName}`.toLowerCase();
      const matchesSearch = text.includes(searchTerm.toLowerCase());

      let matchesCategory = true;
      if (categoryFilter === '__uncategorized__') {
        matchesCategory = !product.category_id;
      } else if (categoryFilter !== 'all') {
        matchesCategory = product.category_id === categoryFilter;
      }

      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, categoryFilter, categories]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));

  const paginatedProducts = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredProducts.slice(start, start + PAGE_SIZE);
  }, [filteredProducts, currentPage, totalPages]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const activeCount = products.filter(p => p.status === 'active').length;
  const archivedCount = products.filter(p => p.status === 'removed').length;
  const lowStockCount = products.filter(
    p => p.status === 'active' && Number(p.stock_qty || 0) <= 0,
  ).length;

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
          <p>Manage your catalog, stock levels, categories, and set rates</p>
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
          <span className="stat-label">Out of Stock</span>
          <span className="stat-value archived">{lowStockCount}</span>
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
                  <label>Category (Optional)</label>
                  <div className="category-input-row">
                    <select
                      name="category_id"
                      value={formData.category_id}
                      onChange={handleInputChange}
                    >
                      <option value="">No category</option>
                      {categories.map(category => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setShowAddCategory(prev => !prev)}
                    >
                      {showAddCategory ? 'Cancel' : 'Add'}
                    </button>
                  </div>
                  {showAddCategory && (
                    <div className="category-create-row">
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="Category name"
                      />
                      <button type="button" className="btn-primary" onClick={addCategory}>Create</button>
                    </div>
                  )}
                </div>

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
                Stock updates automatically when you record purchases and sales. You can also edit stock directly in the product list.
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
          <div className="products-toolbar">
            <select
              className="filter-select"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="all">All categories</option>
              <option value="__uncategorized__">Uncategorized</option>
              {categories.map(category => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
        </div>

        {filteredProducts.length === 0 ? (
          <div className="empty-state">
            <p>No products found</p>
            <button onClick={() => setShowForm(true)} className="btn-primary">
              Create your first product
            </button>
          </div>
        ) : (
          <>
            <div className="products-table">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Stock</th>
                    <th>Unit</th>
                    <th>Set Rate (BDT)</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.map(product => (
                    <tr key={product.product_id} className={product.status === 'removed' ? 'archived' : ''}>
                      <td className="name-cell">{product.name}</td>
                      <td>{categoryNameById(product.category_id)}</td>
                      <td className="stock-cell">
                        {editingStockId === product.product_id ? (
                          <div className="stock-edit-row">
                            <input
                              type="number"
                              className="stock-input"
                              value={stockDraft}
                              onChange={(e) => setStockDraft(e.target.value)}
                              min="0"
                              step="0.001"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveStockEdit(product);
                                if (e.key === 'Escape') cancelStockEdit();
                              }}
                            />
                            <button
                              type="button"
                              className="action-btn edit"
                              title="Save stock"
                              disabled={savingStockId === product.product_id}
                              onClick={() => saveStockEdit(product)}
                            >
                              <Check size={16} />
                            </button>
                            <button
                              type="button"
                              className="action-btn delete"
                              title="Cancel"
                              onClick={cancelStockEdit}
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className={`stock-display ${Number(product.stock_qty || 0) <= 0 ? 'stock-empty' : ''}`}
                            onClick={() => startStockEdit(product)}
                            disabled={product.status !== 'active'}
                            title={product.status === 'active' ? 'Click to edit stock' : 'Archived product'}
                          >
                            {formatStock(product.stock_qty, product.unit)}
                          </button>
                        )}
                      </td>
                      <td>{product.unit || '-'}</td>
                      <td>
                        {product.set_rate ? `${Number(product.set_rate).toFixed(2)}` : '-'}
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
                              onClick={() => handleDelete(product.product_id)}
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

            {totalPages > 1 && (
              <div className="pagination-bar">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(prev => prev - 1)}
                >
                  Previous
                </button>
                <span className="pagination-info">
                  Page {Math.min(currentPage, totalPages)} of {totalPages}
                  {' · '}
                  Showing {paginatedProducts.length} of {filteredProducts.length}
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(prev => prev + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Products;
