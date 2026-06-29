// Currency formatting
export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency: 'BDT',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

// Payment status determination
export const getPaymentStatus = (total, amountPaid) => {
  if (amountPaid === total) return 'Fully Paid';
  if (amountPaid < total) return 'Due';
  if (amountPaid > total) return 'Advance';
};

// Calculate remaining amount (Due or Advance)
export const calculateRemaining = (total, amountPaid) => {
  const remaining = Math.abs(total - amountPaid);
  const status = getPaymentStatus(total, amountPaid);
  return { amount: remaining, status };
};

// Format date to YYYY-MM-DD
export const formatDate = (date) => {
  if (typeof date === 'string') return date;
  return new Date(date).toISOString().split('T')[0];
};

// Parse date string to Date object
export const parseDate = (dateStr) => {
  return new Date(dateStr + 'T00:00:00Z');
};

// Calculate invoice total from line items
export const calculateInvoiceTotal = (lineItems) => {
  return lineItems.reduce((sum, item) => sum + (item.quantity * item.sale_rate), 0);
};

// Generate sequential invoice number
export const generateInvoiceNumber = (userId, existingInvoices) => {
  const maxNumber = existingInvoices.length > 0
    ? Math.max(...existingInvoices.map(inv => {
        const match = inv.invoice_number.match(/\d+$/);
        return match ? parseInt(match[0]) : 0;
      }))
    : 0;
  return `INV-${String(maxNumber + 1).padStart(5, '0')}`;
};

// Calculate profit from allocations
export const calculateProfit = (lineItems, allocations) => {
  const totalSale = lineItems.reduce((sum, item) => sum + item.line_total, 0);
  const totalCost = allocations.reduce((sum, alloc) => sum + alloc.cost_allocated, 0);
  return totalSale - totalCost;
};
