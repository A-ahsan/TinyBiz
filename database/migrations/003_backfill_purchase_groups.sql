-- Migration: Retroactively group purchases that were recorded together
-- Run this in the Supabase SQL Editor AFTER 002_purchase_groups.sql.
-- Safe to run more than once.
--
-- Why: purchases recorded with the old form (one "Amount Paid" per line) were
-- saved as separate rows, so one real purchase shows as several report rows.
-- The old form inserted every line in a single INSERT statement, so all lines of
-- one purchase share an identical created_at (Postgres now() is the transaction
-- timestamp). That makes (user_id, seller_id, date, created_at) an exact match
-- for "these were saved together" — separate submissions differ by microseconds.
--
-- Only rows the app never grouped (purchase_group_id = id) are touched, so
-- purchases already grouped by the new form are left exactly as they are.

-- =============================================================================
-- STEP 1 — PREVIEW (run this alone first, it changes nothing)
-- Check that each returned line really was one purchase before running step 2.
-- =============================================================================

select
  p.created_at,
  p.date,
  s.name        as seller,
  count(*)      as items_to_merge,
  string_agg(pr.name, ', ' order by pr.name) as products,
  sum(p.total_cost)  as combined_total,
  sum(p.amount_paid) as combined_paid
from purchases p
join sellers s  on s.id = p.seller_id
join products pr on pr.id = p.product_id
where p.purchase_group_id = p.id
group by p.user_id, p.seller_id, p.date, p.created_at, s.name
having count(*) > 1
order by p.created_at desc;

-- =============================================================================
-- STEP 2 — APPLY (run this once you are happy with the preview above)
-- =============================================================================

with groups as (
  select
    user_id,
    seller_id,
    date,
    created_at,
    min(id::text)::uuid as group_id
  from purchases
  where purchase_group_id = id
  group by user_id, seller_id, date, created_at
  having count(*) > 1
)
update purchases p
   set purchase_group_id = g.group_id
  from groups g
 where p.purchase_group_id = p.id
   and p.user_id    = g.user_id
   and p.seller_id  = g.seller_id
   and p.date       = g.date
   and p.created_at = g.created_at;
