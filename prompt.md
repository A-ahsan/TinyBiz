# Build Prompt: Multi-Tenant Wholesale Trading Ledger Web App

You are building a complete, production-ready web application from scratch. Read this entire document fully before writing any code. It is meant to be self-contained — everything you need is here. If you find a genuine gap not covered below, state the assumption you're making and proceed with the most sensible default rather than stopping; flag it clearly at the end of your response instead of blocking on it.

---

## 1. What this app does (plain summary)

A small business owner buys products from suppliers and resells them to buyers, at prices that change every single transaction. The app tracks inventory in cost "batches," tracks who owes whom (dues) and who's overpaid (advances) on both the buying and selling side, generates invoices, and gives several different log/report views — always with both an all-time view and a date-filtered view. The app is **multi-tenant**: anyone can sign up and run their own completely separate, isolated business inside the same app.

---

## 2. Tech stack (mandatory — must be free and explicitly allowed for commercial/business use, not just personal/hobby use)

- **Database:** PostgreSQL via **Supabase** (free tier)
- **Auth:** Supabase Auth (free, included) — email/password signup and login
- **Multi-tenancy enforcement:** PostgreSQL **Row Level Security (RLS)** — every table scoped to `user_id = auth.uid()`. This is not optional — do not rely on application-code-only filtering for tenant isolation.
- **Backend/API:** None separate — use Supabase's auto-generated REST API directly from the frontend via `supabase-js`. If genuinely necessary, use Supabase Edge Functions (free, included) for server-side logic (e.g., the FIFO allocation transaction in §6 may be safer as an Edge Function or a Postgres function/RPC call rather than pure client-side logic, to avoid race conditions — your call on implementation, but it must be atomic).
- **Frontend:** React (Vite is fine, no Next.js needed — this app sits entirely behind login, no SSR/SEO need)
- **Hosting (frontend):** Cloudflare Pages (free tier — confirmed to explicitly allow commercial use, unlike some competing free tiers that are personal-use-only)
- **Invoices (PDF):** Generate client-side with a free library (e.g. `jsPDF`) — no paid invoicing API
- **Currency:** BDT (Bangladeshi Taka) — single currency throughout, format as `BDT 1,234.50` or similar, no multi-currency support needed

---

## 3. Core business rules (read carefully — these are the parts most likely to get subtly wrong)

### 3.1 Pricing is never fixed at the product level
- A product can be created with just a name — nothing else is required.
- A product *may* optionally have a "Set Rate" saved on it. This is purely a personal reference number and is NEVER enforced or validated against.
- **Purchase side:** the user always types a fresh "Buying Rate" for every single purchase/batch. It is never pre-filled from anything.
- **Sale side:** when adding a product line to an invoice, the "Sale Rate" field auto-fills from that product's Set Rate *if one exists* — purely as a starting suggestion the user can freely increase or decrease for that specific sale. If no Set Rate exists, the field starts blank. Whatever the user finalizes is what gets saved — the product's Set Rate itself is never modified by a sale.

### 3.2 Batch-based inventory costing (NOT simple averaging — this was explicitly decided)
- The business buys the *same product* from *different sellers*, at *different rates and different quantities*, on different dates. Each purchase is stored as its own independent "batch" (a.k.a. "lot"), each with its own remaining quantity and its own cost rate. Never average purchase costs together into one blended product cost.
- **Allocation rule when selling: strict FIFO (oldest batch first).** This is confirmed, not a placeholder — implement FIFO only, no manual override needed for v1.
- A single sale of quantity Q for a product may need to draw from multiple batches if the oldest batch doesn't have enough remaining quantity by itself. Split the cost calculation accordingly across however many batches are needed, oldest first, until Q is fully covered.
- **Out-of-stock case (default decision — flagged as an assumption, confirm with client if possible, but implement this as the default):** if the sum of all remaining batch quantities for a product is less than the quantity being sold, **block the sale** with a clear validation error showing how much is available vs. how much was requested. Do not allow negative/oversold stock in v1, since there would be no batch to attribute cost to.

### 3.3 Payment status is always one of three states — symmetric on both buy and sell sides
For every Purchase: compare `amount_paid` to `total_cost` (quantity × buying rate).
For every Sale: compare `amount_received` to `total_sale_value` (sum of all line items).
In both cases:
- `paid == total` → **Fully Paid**
- `paid < total` → **Due** (the difference is owed — by the business to the seller, or by the buyer to the business)
- `paid > total` → **Advance** (the excess is credit — held with that seller, or held on behalf of that buyer)

### 3.4 Running balances (per seller, per buyer) — exact formula, do not deviate
Do **not** store a running balance as a column that gets manually incremented/decremented on every transaction (too easy to get out of sync). Instead compute it live via a query or a Postgres VIEW:

```
Seller Running Balance =
    SUM(purchases.total_cost WHERE seller_id = X AND status = 'active')
  - SUM(purchases.amount_paid WHERE seller_id = X AND status = 'active')
  - SUM(payments.amount WHERE party_type = 'seller' AND party_id = X)

Buyer Running Balance =
    SUM(sales.total_sale_value WHERE buyer_id = X AND status = 'active')
  - SUM(sales.amount_received WHERE buyer_id = X AND status = 'active')
  - SUM(payments.amount WHERE party_type = 'buyer' AND party_id = X)
```
Interpretation: **positive = a Due** (business owes the seller, or the buyer owes the business). **Negative = an Advance** (business has prepaid the seller, or the buyer has prepaid the business). Display the absolute value with the correct "Due"/"Advance" label rather than showing a raw negative number to the user.

### 3.5 Voiding transactions (never hard-delete financial records)
- Transactions get a `status` field (`active` / `voided`), never a hard DELETE. This preserves the audit trail required by the logs.
- **Voiding a Purchase (batch):** only allowed if its `remaining_qty` still equals its original `quantity` (i.e., nothing from this batch has been sold yet). If any of it has already been allocated to a sale, block the void with a clear error message. On successful void, the batch no longer counts toward stock or cost calculations.
- **Voiding a Sale:** must reverse all of its batch allocations — add the allocated quantities back to each source batch's `remaining_qty` — then mark the sale `voided`. The sale stops counting toward profit totals and running balances, but remains visible in logs marked as voided (not deleted).

---

## 4. Database schema (Postgres, on Supabase, with RLS)

Use `auth.users` (provided by Supabase Auth) as the root of identity — do not build a separate custom users table for login; instead use a `profiles` table keyed on the same `id` for extra fields.

```sql
-- Extend auth with business profile info
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  business_name text,
  created_at timestamptz default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  set_rate numeric(12,2),              -- nullable, optional
  unit text,                            -- nullable, optional, e.g. 'kg', 'pcs'
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz default now()
);

create table sellers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  store_name text,
  location text,
  email text,
  phone text,
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz default now()
);

create table buyers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  store_name text,
  location text,
  email text,
  phone text,
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz default now()
);

-- Each purchase = one batch/lot
create table purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references sellers(id),
  product_id uuid not null references products(id),
  date date not null,
  quantity numeric(12,3) not null check (quantity > 0),
  buying_rate numeric(12,2) not null check (buying_rate >= 0),
  total_cost numeric(14,2) generated always as (quantity * buying_rate) stored,
  amount_paid numeric(14,2) not null default 0,
  remaining_qty numeric(12,3) not null,   -- starts equal to quantity, decremented on sale allocation
  status text not null default 'active' check (status in ('active','voided')),
  created_at timestamptz default now()
);

-- Each sale = one invoice header
create table sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buyer_id uuid not null references buyers(id),
  invoice_number text not null,           -- auto-generate, unique per user, e.g. sequential per-account
  date date not null,
  amount_received numeric(14,2) not null default 0,
  status text not null default 'active' check (status in ('active','voided')),
  created_at timestamptz default now()
);

-- Line items on an invoice (multi-product, multi-quantity support)
create table sale_line_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity numeric(12,3) not null check (quantity > 0),
  sale_rate numeric(12,2) not null check (sale_rate >= 0),
  line_total numeric(14,2) generated always as (quantity * sale_rate) stored
);

-- Which batch(es) a line item's quantity was drawn from (FIFO), for cost/profit calc
create table sale_allocations (
  id uuid primary key default gen_random_uuid(),
  sale_line_item_id uuid not null references sale_line_items(id) on delete cascade,
  purchase_id uuid not null references purchases(id),
  quantity_allocated numeric(12,3) not null check (quantity_allocated > 0),
  cost_allocated numeric(14,2) not null     -- quantity_allocated * that batch's buying_rate, captured at allocation time
);

-- Standalone payments (clearing a due later, recording an advance, etc.)
create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('to_seller','from_buyer')),
  party_type text not null check (party_type in ('seller','buyer')),
  party_id uuid not null,                  -- references sellers.id or buyers.id depending on party_type
  linked_purchase_id uuid references purchases(id),  -- optional
  linked_sale_id uuid references sales(id),          -- optional
  amount numeric(14,2) not null check (amount > 0),
  payment_type text not null check (payment_type in ('settlement','advance','due_clearance')),
  date date not null,
  created_at timestamptz default now()
);
```

**Row Level Security — apply to every table above (pattern is identical each time):**
```sql
alter table products enable row level security;
create policy "Users manage their own products"
  on products for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
-- Repeat the same enable + policy pattern for: sellers, buyers, purchases, sales, payments.
-- For sale_line_items and sale_allocations (no direct user_id column), scope via a join:
alter table sale_line_items enable row level security;
create policy "Users manage line items on their own sales"
  on sale_line_items for all
  using (exists (select 1 from sales where sales.id = sale_line_items.sale_id and sales.user_id = auth.uid()))
  with check (exists (select 1 from sales where sales.id = sale_line_items.sale_id and sales.user_id = auth.uid()));
-- Same join pattern for sale_allocations, joining through sale_line_items -> sales.
```

**Computed balance views (for the Due/Advance logs and directory pages):**
```sql
create view seller_balances as
select
  s.id as seller_id,
  s.user_id,
  coalesce(sum(p.total_cost) filter (where p.status = 'active'), 0)
    - coalesce(sum(p.amount_paid) filter (where p.status = 'active'), 0)
    - coalesce((select sum(pay.amount) from payments pay where pay.party_type = 'seller' and pay.party_id = s.id), 0)
    as running_balance
from sellers s
left join purchases p on p.seller_id = s.id
group by s.id, s.user_id;

create view buyer_balances as
select
  b.id as buyer_id,
  b.user_id,
  coalesce(sum(sa.total_sale_value) filter (where sa.status = 'active'), 0)
    - coalesce(sum(sa.amount_received) filter (where sa.status = 'active'), 0)
    - coalesce((select sum(pay.amount) from payments pay where pay.party_type = 'buyer' and pay.party_id = b.id), 0)
    as running_balance
from buyers b
left join (
  select sales.id, sales.buyer_id, sales.status, sales.amount_received,
         (select sum(sli.line_total) from sale_line_items sli where sli.sale_id = sales.id) as total_sale_value
  from sales
) sa on sa.buyer_id = b.id
group by b.id, b.user_id;
```
(Apply RLS to these views too, or rely on the underlying table RLS plus filtering by the logged-in user's `user_id` in the query — your call on the cleanest implementation, but the end result must never leak another user's balances.)

---

## 5. FIFO allocation algorithm (implement exactly this logic, on every sale submission)

For each line item (product, quantity Q) on a new invoice:
1. Fetch all `purchases` rows for this `product_id` and this `user_id` where `status = 'active'` and `remaining_qty > 0`, ordered by `date ASC, created_at ASC`.
2. If the sum of all their `remaining_qty` < Q → reject the entire sale submission with an error stating available vs. requested quantity for that product. Do not partially save anything.
3. Otherwise, walk the ordered batch list: for each batch, take `take = min(batch.remaining_qty, Q_remaining_to_allocate)`. Create a `sale_allocations` row with `quantity_allocated = take` and `cost_allocated = take * batch.buying_rate`. Decrement that batch's `remaining_qty` by `take`. Decrement `Q_remaining_to_allocate` by `take`. Continue to the next batch until `Q_remaining_to_allocate` reaches 0.
4. Sum `cost_allocated` across all allocations for all line items on this invoice → this is the invoice's total Cost of Goods.
5. `Profit = (sum of all line_total) - (total Cost of Goods)`.
6. This entire operation (creating the sale, its line items, its allocations, and decrementing batch remaining_qty) **must be atomic** — wrap it in a single database transaction or a Postgres function called via RPC, so a failure partway through never leaves the batches or the invoice in an inconsistent state.

---

## 6. Pages / screens to build

1. **Sign up / Log in / Log out** — Supabase Auth, email + password.
2. **Dashboard** — quick overview: total outstanding dues (both directions), total outstanding advances (both directions), today's/this-month's sales total, today's/this-month's profit total.
3. **Products** — list (name, set rate if any, unit, status), add new (name required, everything else optional), edit, remove (soft delete — removed products disappear from "add purchase/sale" pickers but stay visible in historical records).
4. **Sellers** — list with running balance shown per row (label clearly as Due or Advance), add (name required, rest optional), edit, remove (soft delete).
5. **Buyers** — same pattern as Sellers.
6. **Record Purchase** — pick seller, pick product (or quick-add either inline if they don't exist yet), date, quantity, buying rate, amount paid. Show the computed total cost and resulting Due/Advance live before submitting.
7. **Record Sale (Invoice)** — pick buyer (or quick-add), date, add one or more product lines (each: product, quantity, sale rate — auto-filled from Set Rate if present, editable), amount received. Show computed total sale value and resulting Due/Advance live before submitting. On submit: run the FIFO allocation (§5), then show/generate the finished invoice.
8. **Invoice view** — a clean printable/downloadable (PDF via jsPDF) layout: business name, invoice #, date, buyer info, line items table, total, amount received, due/advance remaining.
9. **Record Payment** — standalone form: party type (buyer/seller), pick the specific party, amount, date, payment type, optional link to a specific past purchase/sale. Used for clearing an old due or logging an advance outside of a new transaction.
10. **Reports / Logs section**, with these views (every one needs a Whole/Date-range toggle — default to Whole on open):
    - **All Transactions Log:** merged purchases + sales, columns: Date, Type, Party, Product(s), Quantity, Rate, Total, Paid/Received, Status. Filterable additionally by product/buyer/seller.
    - **Due Log:** two sections — "Buyers who owe me" and "I owe these sellers" — columns: Party Name, Total Due, # Unpaid/Partial Transactions, Oldest Due Date, Last Activity. Clicking a row opens that party's Individual Log.
    - **Advance Log:** same two-section structure, mirrored for advances — columns: Party Name, Total Advance, Date Created, Last Activity.
    - **Profit Log:** Whole = all-time total + per-sale list; Date-wise = total for the chosen range + filtered list. Columns: Date, Invoice #, Buyer, Product(s), Sale Value, Cost of Goods, Profit. Add grouping by day/week/month, by product, by buyer.
    - **Individual Buyer/Seller Log:** pick one party, see their full history (every purchase/sale + payment with them) plus running balance after each entry, over the Whole history or a chosen date range.
11. **Buyer/Seller Directory** — simple list view linking into the Individual Log, doubling as the entry point for #4/#5 above.

---

## 7. Worked example — use this to verify correctness once built (numbers must reproduce exactly)

1. Jun 1 — Buy 50kg Product A from Seller X @ BDT 100/kg = BDT 5,000 total. Amount paid: BDT 4,000. → Due to Seller X: BDT 1,000. Batch #1: remaining_qty 50.
2. Jun 5 — Buy 30kg Product A from Seller Y @ BDT 110/kg = BDT 3,300 total. Amount paid: BDT 3,500. → Advance with Seller Y: BDT 200. Batch #2: remaining_qty 30.
3. Jun 10 — Sell 60kg Product A to Buyer Z @ BDT 120/kg = BDT 7,200 total. Amount received: BDT 7,200 (fully paid).
   - FIFO allocation: 50kg from Batch #1 (cost = 50 × 100 = BDT 5,000) + 10kg from Batch #2 (cost = 10 × 110 = BDT 1,100). Total cost of goods = BDT 6,100.
   - Profit = 7,200 − 6,100 = **BDT 1,100**.
   - Batch #1 remaining_qty → 0. Batch #2 remaining_qty → 20.
4. After this, Seller X's running balance should show a **Due of BDT 1,000**. Seller Y's running balance should show an **Advance of BDT 200**. Buyer Z's running balance should show **BDT 0** (fully paid, nothing owed either direction).

---

## 8. Things that are easy to miss — do not skip these

- Set Rate on a product is genuinely optional at every layer (DB allows null, form doesn't require it, sale-rate pre-fill gracefully handles the null case by just leaving the field blank).
- Name is the only mandatory field on Buyer and Seller — every other contact field must be optional in the form and the DB schema (nullable).
- Buying Rate and Sale Rate are entered completely independently — never derive one from the other.
- A product, buyer, or seller that's been "removed" must NOT disappear from historical records, invoices, or logs — only from the pickers used when creating new purchases/sales.
- Running balances must be computed live (via the views in §4), not stored/incremented manually, to avoid drift bugs.
- Voiding a purchase must check `remaining_qty == quantity` first (see §3.5) — don't allow voiding a batch that's already been partially or fully sold.
- Voiding a sale must reverse its allocations (restore `remaining_qty` on each affected batch) before marking it voided.
- The out-of-stock case (§3.2) must produce a clear, specific error — not a silent failure or a generic "error occurred."
- Every report/log needs both the Whole view and the Date-wise view — building only one of the two is incomplete.
- RLS must be enabled and tested on every table (and via the join pattern for `sale_line_items`/`sale_allocations`) — verify one test user genuinely cannot query another test user's data before considering this done.
- Multi-product invoices: the sale form must support adding an arbitrary number of line items per invoice, each independently quantified and priced.

---

## 9. Scope explicitly excluded from v1 (don't build these unless asked)
- No staff/team accounts or permission tiers — single owner per account, full access.
- No billing/subscription logic — the app itself is free to use.
- No multi-business-per-account support — one shop per signed-up account.
- No multi-currency support — BDT only.
- No manual batch-allocation override — FIFO only.

---

Build this completely, then walk through the worked example in §7 against your own running app to self-verify before handing it back.
