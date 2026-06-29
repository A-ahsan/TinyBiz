# TinyBiz - Step-by-Step Setup Guide

## What I've Done So Far

### 1. **Database Schema** (`/database/schema.sql`)
- Created complete PostgreSQL schema with all required tables:
  - `profiles` - extends Supabase Auth with business info
  - `products` - inventory items with optional set rates
  - `sellers` - supplier directory
  - `buyers` - customer directory
  - `purchases` - batch-based cost inventory
  - `sales` - invoices header
  - `sale_line_items` - multi-product support per invoice
  - `sale_allocations` - FIFO cost tracking
  - `payments` - standalone payment records
  - Views for seller & buyer running balances (computed live, not stored)
- Applied Row Level Security (RLS) on all tables for multi-tenant isolation
- Added performance indexes on commonly queried columns

### 2. **Frontend Project Structure** (`/frontend`)
- Initialized React + Vite project
- Installed dependencies:
  - `@supabase/supabase-js` - Supabase client
  - `jspdf` - PDF invoice generation
  - `react-router-dom` - Client-side routing
  - `date-fns` - Date utilities
  - `lucide-react` - Icon library

### 3. **Core Configuration**
- `.env.local` - Supabase credentials configured
- Supabase client initialization (`/lib/supabase.js`)
- Auth context & hooks for user state management
- Constants and helper functions for business logic

### 4. **UI Components & Pages**
- **Sidebar Navigation** - Main navigation with all routes
- **Auth Pages** - Sign Up & Sign In forms
- **Page Templates** - Placeholder pages for:
  - Dashboard
  - Products management
  - Sellers directory
  - Buyers directory
  - Record Purchase
  - Record Sale (Invoice)
  - Reports & Logs

### 5. **Styling**
- Custom CSS with color scheme and typography
- Responsive design patterns
- Form, button, table, and card styles

---

## Next Steps - In Order

### **CRITICAL FIRST: Apply Database Schema to Supabase**

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click on your project
3. Go to **SQL Editor** (left sidebar)
4. Click **New Query**
5. Copy & paste all content from `/database/schema.sql`
6. Click **Run** button
7. Wait for success message (all tables and RLS policies created)

**After this step, your database is production-ready.**

---

### **Phase 1: Test Auth Flow (Today)**
- [ ] Run frontend: `npm run dev` from `/frontend` folder
- [ ] Sign up a test user
- [ ] Verify user created in Supabase > Auth > Users
- [ ] Verify profile auto-created in `profiles` table
- [ ] Sign out and sign back in
- [ ] Check sidebar shows business name

### **Phase 2: Build Products Page** (Tomorrow)
- Add/list/edit/remove products
- Optional set rate field
- Soft delete support (status = 'removed')

### **Phase 3: Build Sellers & Buyers** (Day 3)
- Add/list/edit/remove sellers and buyers
- Display running balance per party (from the view)
- Link to individual transaction logs

### **Phase 4: Record Purchase** (Day 4)
- Pick seller + product (or quick-add)
- Enter date, quantity, buying rate
- Show computed total_cost live
- Show Due/Advance status live
- Submit creates batch with remaining_qty = quantity

### **Phase 5: Record Sale / Invoice** (Day 5)
- Multi-line item form
- Sale rate auto-fills from product's set_rate (or blank if none)
- Implements FIFO allocation atomically:
  - Validates stock availability
  - Allocates to batches oldest-first
  - Calculates cost of goods & profit
  - Updates remaining_qty on each batch
  - Generates invoice number
  - Creates PDF invoice
- Shows Due/Advance live before submit

### **Phase 6: Standalone Payments** (Day 6)
- Record payment to/from seller/buyer
- Optional link to specific purchase/sale
- Updates running balance via payment records

### **Phase 7: Reports & Logs** (Day 7)
- All Transactions Log (merged purchases + sales, filterable)
- Due Log (two sections: "Buyers owe me" + "I owe sellers")
- Advance Log (mirrored structure)
- Profit Log (with day/week/month grouping)
- Individual Party Log (full history for one buyer/seller)
- Every report has Whole + Date-range toggle

### **Phase 8: Verification**
- Walk through §7 worked example manually:
  1. Buy 50kg Product A from Seller X @ BDT 100/kg, pay BDT 4,000 (Due: 1,000)
  2. Buy 30kg Product A from Seller Y @ BDT 110/kg, pay BDT 3,500 (Advance: 200)
  3. Sell 60kg to Buyer Z @ BDT 120/kg, receive BDT 7,200
     - FIFO: 50kg from X + 10kg from Y = cost BDT 6,100
     - Profit: 7,200 - 6,100 = **BDT 1,100** ✓
- Verify balances in directory pages match expected values

---

## Running the App Locally

```bash
# In the /frontend folder:
npm install              # Already done
npm run dev              # Starts dev server on http://localhost:5173
```

Ctrl+C to stop.

---

## File Structure (Current)

```
TinyBiz/
├── prompt.md                    # Original spec document
├── .git/                        # Git initialized
├── database/
│   └── schema.sql              # PostgreSQL DDL + RLS policies
├── docs/                        # Documentation folder (empty for now)
├── frontend/
│   ├── src/
│   │   ├── App.jsx             # Main routing component
│   │   ├── App.css             # Global styles
│   │   ├── main.jsx            # React entry point
│   │   ├── lib/
│   │   │   ├── supabase.js     # Supabase client
│   │   │   └── AuthContext.jsx # Auth state & hooks
│   │   ├── components/
│   │   │   ├── Sidebar.jsx     # Main navigation
│   │   │   └── Sidebar.css
│   │   ├── pages/
│   │   │   ├── SignUp.jsx
│   │   │   ├── SignIn.jsx
│   │   │   ├── Auth.css
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Products.jsx
│   │   │   ├── Sellers.jsx
│   │   │   ├── Buyers.jsx
│   │   │   ├── RecordPurchase.jsx
│   │   │   ├── RecordSale.jsx
│   │   │   ├── Reports.jsx
│   │   │   └── Page.css
│   │   ├── hooks/               # (empty, for future custom hooks)
│   │   ├── utils/
│   │   │   ├── helpers.js      # Business logic helpers
│   │   │   └── constants.js    # App constants
│   │   └── assets/
│   ├── package.json
│   ├── .env.local               # Supabase credentials (DO NOT COMMIT)
│   ├── vite.config.js
│   └── index.html
```

---

## What You Need to Do NOW

1. **Apply the database schema** to your Supabase project (copy-paste from `schema.sql` into SQL Editor)
2. **Confirm the connection** by signing up a test user
3. **Tell me when ready**, and we'll build Phase 1-2 (Products page)

Any questions?
