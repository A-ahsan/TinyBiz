-- TinyBiz Multi-Tenant Wholesale Ledger Schema
-- PostgreSQL on Supabase with Row Level Security

-- =============================================================================
-- 1. PROFILES TABLE (extends Supabase Auth)
-- =============================================================================

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  business_name text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Users can view their own profile"
  on profiles for select
  using (id = auth.uid());

create policy "Users can update their own profile"
  on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- =============================================================================
-- 2. PRODUCTS TABLE
-- =============================================================================

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  set_rate numeric(12,2),              -- nullable, optional
  unit text,                            -- nullable, optional, e.g. 'kg', 'pcs'
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz default now()
);

alter table products enable row level security;

create policy "Users manage their own products"
  on products for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- 3. SELLERS TABLE
-- =============================================================================

create table if not exists sellers (
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

alter table sellers enable row level security;

create policy "Users manage their own sellers"
  on sellers for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- 4. BUYERS TABLE
-- =============================================================================

create table if not exists buyers (
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

alter table buyers enable row level security;

create policy "Users manage their own buyers"
  on buyers for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- 5. PURCHASES TABLE (each purchase = one batch/lot)
-- =============================================================================

create table if not exists purchases (
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

alter table purchases enable row level security;

create policy "Users manage their own purchases"
  on purchases for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- 6. SALES TABLE (each sale = one invoice header)
-- =============================================================================

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buyer_id uuid not null references buyers(id),
  invoice_number text not null,           -- auto-generate, unique per user, e.g. sequential per-account
  date date not null,
  amount_received numeric(14,2) not null default 0,
  status text not null default 'active' check (status in ('active','voided')),
  created_at timestamptz default now()
);

alter table sales enable row level security;

create policy "Users manage their own sales"
  on sales for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- 7. SALE LINE ITEMS TABLE (multi-product support per invoice)
-- =============================================================================

create table if not exists sale_line_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity numeric(12,3) not null check (quantity > 0),
  sale_rate numeric(12,2) not null check (sale_rate >= 0),
  line_total numeric(14,2) generated always as (quantity * sale_rate) stored
);

alter table sale_line_items enable row level security;

create policy "Users manage line items on their own sales"
  on sale_line_items for all
  using (exists (select 1 from sales where sales.id = sale_line_items.sale_id and sales.user_id = auth.uid()))
  with check (exists (select 1 from sales where sales.id = sale_line_items.sale_id and sales.user_id = auth.uid()));

-- =============================================================================
-- 8. SALE ALLOCATIONS TABLE (FIFO batch allocation for cost/profit calc)
-- =============================================================================

create table if not exists sale_allocations (
  id uuid primary key default gen_random_uuid(),
  sale_line_item_id uuid not null references sale_line_items(id) on delete cascade,
  purchase_id uuid not null references purchases(id),
  quantity_allocated numeric(12,3) not null check (quantity_allocated > 0),
  cost_allocated numeric(14,2) not null     -- quantity_allocated * that batch's buying_rate, captured at allocation time
);

alter table sale_allocations enable row level security;

create policy "Users manage allocations on their own sales"
  on sale_allocations for all
  using (exists (
    select 1 from sale_line_items sli
    join sales s on s.id = sli.sale_id
    where sli.id = sale_allocations.sale_line_item_id and s.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from sale_line_items sli
    join sales s on s.id = sli.sale_id
    where sli.id = sale_allocations.sale_line_item_id and s.user_id = auth.uid()
  ));

-- =============================================================================
-- 9. PAYMENTS TABLE (standalone payment recording)
-- =============================================================================

create table if not exists payments (
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

alter table payments enable row level security;

create policy "Users manage their own payments"
  on payments for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- 10. SELLER BALANCES VIEW
-- =============================================================================

create or replace view seller_balances as
select
  s.id as seller_id,
  s.user_id,
  s.name as seller_name,
  s.store_name,
  s.location,
  s.email,
  s.phone,
  s.status,
  coalesce(sum(p.total_cost) filter (where p.status = 'active'), 0)
    - coalesce(sum(p.amount_paid) filter (where p.status = 'active'), 0)
    - coalesce((select sum(pay.amount) from payments pay where pay.party_type = 'seller' and pay.party_id = s.id and pay.user_id = s.user_id), 0)
    as running_balance
from sellers s
left join purchases p on p.seller_id = s.id
where s.status = 'active'
group by s.id, s.user_id, s.name, s.store_name, s.location, s.email, s.phone, s.status;

-- =============================================================================
-- 11. BUYER BALANCES VIEW
-- =============================================================================

create or replace view buyer_balances as
select
  b.id as buyer_id,
  b.user_id,
  b.name as buyer_name,
  b.store_name,
  b.location,
  b.email,
  b.phone,
  b.status,
  coalesce(sum(sa.total_sale_value) filter (where sa.status = 'active'), 0)
    - coalesce(sum(sa.amount_received) filter (where sa.status = 'active'), 0)
    - coalesce((select sum(pay.amount) from payments pay where pay.party_type = 'buyer' and pay.party_id = b.id and pay.user_id = b.user_id), 0)
    as running_balance
from buyers b
left join (
  select sales.id, sales.buyer_id, sales.status, sales.amount_received, sales.user_id,
         (select sum(sli.line_total) from sale_line_items sli where sli.sale_id = sales.id) as total_sale_value
  from sales
) sa on sa.buyer_id = b.id
where b.status = 'active'
group by b.id, b.user_id, b.name, b.store_name, b.location, b.email, b.phone, b.status;

-- =============================================================================
-- 12. INDEXES (for performance on common queries)
-- =============================================================================

create index if not exists idx_purchases_user_id on purchases(user_id);
create index if not exists idx_purchases_seller_id on purchases(seller_id);
create index if not exists idx_purchases_product_id on purchases(product_id);
create index if not exists idx_purchases_status on purchases(status);
create index if not exists idx_purchases_date on purchases(date);

create index if not exists idx_sales_user_id on sales(user_id);
create index if not exists idx_sales_buyer_id on sales(buyer_id);
create index if not exists idx_sales_status on sales(status);
create index if not exists idx_sales_date on sales(date);

create index if not exists idx_sale_line_items_sale_id on sale_line_items(sale_id);
create index if not exists idx_sale_line_items_product_id on sale_line_items(product_id);

create index if not exists idx_sale_allocations_sale_line_item_id on sale_allocations(sale_line_item_id);
create index if not exists idx_sale_allocations_purchase_id on sale_allocations(purchase_id);

create index if not exists idx_payments_user_id on payments(user_id);
create index if not exists idx_payments_party_id on payments(party_id);
create index if not exists idx_payments_date on payments(date);

create index if not exists idx_products_user_id on products(user_id);
create index if not exists idx_products_status on products(status);

create index if not exists idx_sellers_user_id on sellers(user_id);
create index if not exists idx_sellers_status on sellers(status);

create index if not exists idx_buyers_user_id on buyers(user_id);
create index if not exists idx_buyers_status on buyers(status);
