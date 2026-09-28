-- Keep raw snapshots intact; assemble adjacent same-speaker passages for reads.
CREATE VIEW "merged_transcripts" AS
WITH ordered AS (
  SELECT *,
    CASE WHEN lag(role) OVER (
      PARTITION BY session_id ORDER BY start_ms, created_at, id
    ) IS DISTINCT FROM role THEN 1 ELSE 0 END AS begins_passage
  FROM transcript_snapshots
), grouped AS (
  SELECT *,
    sum(begins_passage) OVER (
      PARTITION BY session_id ORDER BY start_ms, created_at, id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS passage
  FROM ordered
)
SELECT
  (array_agg(id ORDER BY start_ms, created_at, id))[1] AS id,
  session_id,
  role,
  string_agg(text, '' ORDER BY start_ms, created_at, id) AS text,
  min(start_ms) AS start_ms,
  max(end_ms) AS end_ms,
  min(created_at) AS created_at
FROM grouped
GROUP BY session_id, passage, role;
