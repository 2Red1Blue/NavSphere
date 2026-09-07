/**
 * Append to a WITH clause after a caller-owned retention_source CTE whose ts is
 * discovered_at and whose other columns are an explicit, static projection.
 * The normalized CTE preserves that projection and adds utc_timestamp (or NULL
 * for invalid dates). No runtime values or caller SQL are interpolated here.
 *
 * D1 caps each GLOB pattern at 50 bytes. Normalize whole seconds separately and
 * truncate fractions to milliseconds so SQLite cannot round across the cutoff.
 */
export const D1_RETENTION_TIMESTAMP_CTES = `parts AS (
  SELECT *, CASE WHEN substr(ts, -1) = 'Z' THEN 'Z'
    WHEN substr(ts, -6, 1) IN ('+', '-') THEN substr(ts, -6)
    ELSE NULL END AS zone
  FROM retention_source
), fractions AS (
  SELECT *, substr(ts, 20, length(ts) - 19 - length(zone)) AS fraction FROM parts
), normalized AS (
  SELECT *, CASE WHEN typeof(ts) = 'text' AND length(ts) >= 20
    AND substr(ts, 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND substr(ts, 11, 1) = 'T'
    AND substr(ts, 12, 8) GLOB '[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND substr(ts, 12, 2) BETWEEN '00' AND '23'
    AND substr(ts, 15, 2) BETWEEN '00' AND '59'
    AND substr(ts, 18, 2) BETWEEN '00' AND '59'
    AND strftime('%Y-%m-%dT%H:%M:%S', substr(ts, 1, 19), '+0 seconds') = substr(ts, 1, 19)
    AND (zone = 'Z' OR (zone GLOB '[+-][0-9][0-9]:[0-9][0-9]'
      AND substr(zone, 2, 2) <= '14' AND substr(zone, 5, 2) <= '59'
      AND (substr(zone, 2, 2) < '14' OR substr(zone, 5, 2) = '00')))
    AND (fraction = '' OR (substr(fraction, 1, 1) = '.' AND length(fraction) >= 2
      AND substr(fraction, 2) NOT GLOB '*[^0-9]*'))
    THEN strftime('%Y-%m-%dT%H:%M:%S', substr(ts, 1, 19) || zone)
      || '.' || substr(substr(fraction, 2) || '000', 1, 3) || 'Z'
    ELSE NULL END AS utc_timestamp
  FROM fractions
)`
