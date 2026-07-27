-- Migration: Freeze party/product names onto transactions
-- Run this in the Supabase SQL Editor. Safe to run more than once.
--
-- Problem: reports and invoices resolve names live through the product/buyer/
-- seller tables, so renaming "Rice" to "Rice (Premium)" silently rewrites every
-- past invoice and log entry. A document must keep saying what it said when it
-- was issued.
--
-- Fix: each transaction stores the name as it was at the moment it was recorded.
-- Triggers fill these columns, so every write path is covered automatically —
-- the app, the perform_sale RPC, and adjust_product_stock alike. The columns are
-- nullable and the UI falls back to the live name when a snapshot is absent, so
-- rows written before this migration keep displaying exactly as they do now.

-- =============================================================================
-- STEP 1 — Snapshot columns
-- =============================================================================

alter table purchases       add column if not exists seller_name_snapshot  text;
alter table purchases       add column if not exists product_name_snapshot text;
alter table sales           add column if not exists buyer_name_snapshot   text;
alter table sale_line_items add column if not exists product_name_snapshot text;
alter table payments        add column if not exists party_name_snapshot   text;

-- =============================================================================
-- STEP 2 — Triggers that capture the name at write time
-- =============================================================================

create or replace function snapshot_purchase_names()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.seller_name_snapshot is null then
    select name into new.seller_name_snapshot from sellers where id = new.seller_id;
  end if;
  if new.product_name_snapshot is null then
    select name into new.product_name_snapshot from products where id = new.product_id;
  end if;
  return new;
end;
$$;

create or replace function snapshot_sale_names()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.buyer_name_snapshot is null then
    select name into new.buyer_name_snapshot from buyers where id = new.buyer_id;
  end if;
  return new;
end;
$$;

create or replace function snapshot_line_item_names()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.product_name_snapshot is null then
    select name into new.product_name_snapshot from products where id = new.product_id;
  end if;
  return new;
end;
$$;

create or replace function snapshot_payment_names()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.party_name_snapshot is null then
    if new.party_type = 'seller' then
      select name into new.party_name_snapshot from sellers where id = new.party_id;
    else
      select name into new.party_name_snapshot from buyers where id = new.party_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_snapshot_purchase_names on purchases;
create trigger trg_snapshot_purchase_names
  before insert on purchases
  for each row execute function snapshot_purchase_names();

drop trigger if exists trg_snapshot_sale_names on sales;
create trigger trg_snapshot_sale_names
  before insert on sales
  for each row execute function snapshot_sale_names();

drop trigger if exists trg_snapshot_line_item_names on sale_line_items;
create trigger trg_snapshot_line_item_names
  before insert on sale_line_items
  for each row execute function snapshot_line_item_names();

drop trigger if exists trg_snapshot_payment_names on payments;
create trigger trg_snapshot_payment_names
  before insert on payments
  for each row execute function snapshot_payment_names();

-- =============================================================================
-- STEP 3 — Backfill existing rows with today's names
-- The true historical name is unrecoverable for old rows; the current name is
-- the best available value, and it is what those rows already display.
-- =============================================================================

update purchases p
   set seller_name_snapshot = s.name
  from sellers s
 where s.id = p.seller_id and p.seller_name_snapshot is null;

update purchases p
   set product_name_snapshot = pr.name
  from products pr
 where pr.id = p.product_id and p.product_name_snapshot is null;

update sales sa
   set buyer_name_snapshot = b.name
  from buyers b
 where b.id = sa.buyer_id and sa.buyer_name_snapshot is null;

update sale_line_items sli
   set product_name_snapshot = pr.name
  from products pr
 where pr.id = sli.product_id and sli.product_name_snapshot is null;

update payments pay
   set party_name_snapshot = s.name
  from sellers s
 where s.id = pay.party_id and pay.party_type = 'seller' and pay.party_name_snapshot is null;

update payments pay
   set party_name_snapshot = b.name
  from buyers b
 where b.id = pay.party_id and pay.party_type = 'buyer' and pay.party_name_snapshot is null;
