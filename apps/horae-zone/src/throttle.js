/**
 * Sliding-window rate limits kept in D1. A bucket is a closed prefix and a
 * keyed hash (never an address or a connecting address in the clear), or a
 * closed name with no key for a global cap (DAILY_BUCKET in signup.js). One
 * statement checks every bucket and records a row in each only when all are
 * under their limit, so two requests cannot both take the last place and a
 * refused request is not counted. Rows past the window are purged hourly
 * (src/retention.js).
 */

// Returns true when the request is admitted (and counted), false when any
// bucket is full. A bucket's own windowMs, when given, replaces windowMs. A
// bucket's quietMs, when above 0, also refuses while the bucket has a row
// newer than quietMs (a pair backoff, src/signin.js), in the same statement.
export async function admitThrottle(db, now, windowMs, buckets) {
  const pick = buckets.map(() => "SELECT ? AS bucket").join(" UNION ALL ");
  const quiet = (b) => (b.quietMs ?? 0) > 0;
  const under = buckets.map((b) => "(SELECT COUNT(*) FROM throttle WHERE bucket = ? AND at > ?) < ?"
    + (quiet(b) ? " AND NOT EXISTS (SELECT 1 FROM throttle WHERE bucket = ? AND at > ?)" : "")).join(" AND ");
  // Placeholders in text order: `at`, the picked buckets, then each bucket's checks.
  const values = [now, ...buckets.map((b) => b.bucket), ...buckets.flatMap((b) => [
    b.bucket, now - (b.windowMs ?? windowMs), b.limit,
    ...(quiet(b) ? [b.bucket, now - b.quietMs] : []),
  ])];
  const { results } = await db.prepare(
    `INSERT INTO throttle (bucket, at) SELECT bucket, ? FROM (${pick}) WHERE ${under} RETURNING bucket`,
  ).bind(...values).all();
  return results.length === buckets.length;
}

// The statement that takes back one row admitThrottle recorded in `bucket` at
// `now`, for a try that turned out not to count. Returned unrun, so a caller
// can batch it with the write that depends on it.
export function releaseThrottle(db, bucket, now) {
  return db.prepare("DELETE FROM throttle WHERE rowid = (SELECT rowid FROM throttle WHERE bucket = ? AND at = ? LIMIT 1)").bind(bucket, now);
}
