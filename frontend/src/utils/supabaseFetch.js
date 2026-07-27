// Supabase/PostgREST caps an un-ranged query at 1000 rows and returns the first
// page silently — which would quietly understate every report total once a
// ledger grows past that. These helpers page through the full result set.
//
// buildQuery must be a FUNCTION returning a fresh query builder: a builder is
// single-use, so it cannot be reused across pages.

const PAGE_SIZE = 1000;

// Ids travel in the URL, so a huge .in(...) list can exceed the request line
// limit. Chunk them well under it.
const ID_CHUNK_SIZE = 150;

export const fetchAllRows = async (buildQuery) => {
  const rows = [];
  let from = 0;

  for (;;) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    const batch = data || [];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
};

export const fetchAllByIds = async (buildQuery, column, ids) => {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return [];

  const rows = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK_SIZE) {
    const chunk = unique.slice(i, i + ID_CHUNK_SIZE);
    rows.push(...await fetchAllRows(() => buildQuery().in(column, chunk)));
  }

  return rows;
};
