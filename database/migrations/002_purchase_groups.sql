-- Migration: Group multi-item purchases under one purchase entry
-- Run this in the Supabase SQL Editor (copy/paste the whole file).
-- Safe to run on an existing TinyBiz database, and safe to run more than once.
--
-- Why: recording 3 products from the same seller on the same day creates 3
-- purchase batches (needed for FIFO costing), but it is one real-world purchase.
-- These columns let the UI collect one "Amount Paid" and let Reports show one row,
-- without changing how batches or the balance views work.

alter table purchases add column if not exists purchase_group_id uuid;
alter table purchases add column if not exists purchase_number text;

-- Existing rows each become their own single-item group, so nothing regroups
-- retroactively and historical reports keep showing exactly what they showed before.
update purchases
  set purchase_group_id = id
  where purchase_group_id is null;

create index if not exists idx_purchases_group_id on purchases(purchase_group_id);
