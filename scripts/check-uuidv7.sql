-- ---------------------------------------------------------------------------
-- Proves uuidv7() is a CORRECT, TIME-SORTABLE v7 — not merely that it returns a uuid.
--
-- This matters more than it looks. Every primary key in the system defaults to this
-- function, and the two ways it can be quietly wrong are both invisible in normal use:
--
--   1. Right shape, wrong version nibble — passes every insert, breaks any consumer
--      that parses the version, and misrepresents the id format to anything downstream.
--   2. Right shape, NOT time-sortable — passes every test at low volume, and only shows
--      up in production as random B-tree insertion points and page splits across every
--      table. That is precisely the failure the previous gen_random_uuid() shim would
--      have shipped.
--
-- Each check RAISES EXCEPTION on failure, so a non-zero psql exit is the signal.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

DO $check$
DECLARE
  sample uuid;
  version_nibble int;
  variant_bits int;
  bytes bytea;
BEGIN
  sample := uuidv7();
  bytes := uuid_send(sample);

  -- ---- 1. Version must be 7 (high nibble of byte 6). ----
  version_nibble := get_byte(bytes, 6) >> 4;
  IF version_nibble <> 7 THEN
    RAISE EXCEPTION 'uuidv7() produced version % (expected 7): %', version_nibble, sample;
  END IF;

  -- ---- 2. Variant must be 0b10 (top two bits of byte 8). ----
  variant_bits := get_byte(bytes, 8) >> 6;
  IF variant_bits <> 2 THEN
    RAISE EXCEPTION 'uuidv7() produced variant %b (expected 10b): %', variant_bits, sample;
  END IF;

  RAISE NOTICE 'uuidv7(): version and variant bits correct (%).', sample;
END
$check$;

-- ---- 3. The embedded timestamp must match wall clock. ----
DO $check$
DECLARE
  bytes bytea;
  embedded_ms bigint;
  actual_ms bigint;
  drift_ms bigint;
BEGIN
  bytes := uuid_send(uuidv7());

  -- Reassemble the leading 48 bits as a big-endian integer.
  embedded_ms := (get_byte(bytes, 0)::bigint << 40)
               | (get_byte(bytes, 1)::bigint << 32)
               | (get_byte(bytes, 2)::bigint << 24)
               | (get_byte(bytes, 3)::bigint << 16)
               | (get_byte(bytes, 4)::bigint << 8)
               |  get_byte(bytes, 5)::bigint;

  actual_ms := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  drift_ms  := abs(actual_ms - embedded_ms);

  -- Generous window; the point is to catch a timestamp that is absent, byte-swapped or
  -- in the wrong unit, all of which are off by orders of magnitude.
  IF drift_ms > 5000 THEN
    RAISE EXCEPTION 'uuidv7() timestamp drift % ms (embedded %, actual %) — wrong unit or byte order?',
      drift_ms, embedded_ms, actual_ms;
  END IF;

  RAISE NOTICE 'uuidv7(): embedded timestamp within % ms of wall clock.', drift_ms;
END
$check$;

-- ---- 4. Uniqueness across a large batch. ----
DO $check$
DECLARE
  total int;
  distinct_count int;
BEGIN
  CREATE TEMP TABLE uuidv7_sample AS
  SELECT uuidv7() AS id FROM generate_series(1, 20000);

  SELECT count(*), count(DISTINCT id) INTO total, distinct_count FROM uuidv7_sample;

  IF distinct_count <> total THEN
    RAISE EXCEPTION 'uuidv7() produced % duplicates in % values', total - distinct_count, total;
  END IF;

  RAISE NOTICE 'uuidv7(): % values, all distinct.', total;
END
$check$;

-- ---- 5. TIME-SORTABLE. The whole reason v7 was chosen (docs/DATABASE.md §1). ----
DO $check$
DECLARE
  first_batch uuid;
  second_batch uuid;
  ascending_pairs int;
  total_pairs int;
BEGIN
  first_batch := uuidv7();
  PERFORM pg_sleep(0.05);
  second_batch := uuidv7();

  IF NOT (second_batch > first_batch) THEN
    RAISE EXCEPTION 'uuidv7() is NOT time-sortable: % generated after % but sorts before it',
      second_batch, first_batch;
  END IF;

  /*
   * Within a single millisecond the trailing bits are random, so adjacent values are
   * not strictly ordered — that is expected and allowed by RFC 9562. What must hold is
   * that ordering is overwhelmingly monotonic across a batch spanning several
   * milliseconds. A v4 masquerading as v7 would score ~50% here.
   */
  CREATE TEMP TABLE uuidv7_ordered AS
  SELECT row_number() OVER () AS seq, id
  FROM (
    SELECT uuidv7() AS id
    FROM generate_series(1, 500) AS g
    -- Spread generation across time so the millisecond prefix actually varies.
    WHERE pg_sleep(0.001) IS NOT NULL
  ) s;

  SELECT count(*) FILTER (WHERE next_id > id), count(*)
  INTO ascending_pairs, total_pairs
  FROM (
    SELECT id, lead(id) OVER (ORDER BY seq) AS next_id FROM uuidv7_ordered
  ) pairs
  WHERE next_id IS NOT NULL;

  IF ascending_pairs::numeric / total_pairs < 0.95 THEN
    RAISE EXCEPTION 'uuidv7() is not monotonic enough to be time-sortable: only %/% pairs ascend',
      ascending_pairs, total_pairs;
  END IF;

  RAISE NOTICE 'uuidv7(): time-sortable — %/% consecutive pairs ascend.', ascending_pairs, total_pairs;
END
$check$;

SELECT '✅ uuidv7() is a correct, unique, time-sortable RFC 9562 v7.' AS result;
