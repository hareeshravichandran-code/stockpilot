/**
 * Supabase returns at most 1000 rows per request (PostgREST max-rows), whatever .range() asks for.
 * allRows pages through a query 1000 at a time. build() must return a fresh query (with order) each call.
 */
async function allRows(build, max = 10000) {
  const out = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build().range(from, Math.min(from + 999, max - 1));
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
module.exports = { allRows };
