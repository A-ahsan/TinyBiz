// Payment statuses
export const PAYMENT_STATUSES = {
  FULLY_PAID: 'Fully Paid',
  DUE: 'Due',
  ADVANCE: 'Advance',
};

// Transaction statuses
export const TRANSACTION_STATUS = {
  ACTIVE: 'active',
  VOIDED: 'voided',
};

// Payment types
export const PAYMENT_TYPES = {
  SETTLEMENT: 'settlement',
  ADVANCE: 'advance',
  DUE_CLEARANCE: 'due_clearance',
};

// Payment directions
export const PAYMENT_DIRECTIONS = {
  TO_SELLER: 'to_seller',
  FROM_BUYER: 'from_buyer',
};

// Party types
export const PARTY_TYPES = {
  SELLER: 'seller',
  BUYER: 'buyer',
};

// Entity statuses
export const ENTITY_STATUS = {
  ACTIVE: 'active',
  REMOVED: 'removed',
};

// Date range presets
export const DATE_PRESETS = {
  WHOLE: 'whole',
  TODAY: 'today',
  THIS_WEEK: 'this_week',
  THIS_MONTH: 'this_month',
  CUSTOM: 'custom',
};
