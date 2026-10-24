-- ---------------------------------------------------------------------------
-- Bootstrap: extensions and functions the schema DEPENDS ON.
--
-- Applied BEFORE migrations, because the migration DDL references both `pg_trgm`
-- (search indexes) and `uuidv7()` (every primary-key default). Postgres resolves a
-- column default's function at DDL time, so a missing `uuidv7()` fails the migration
-- outright rather than later at insert time.
--
-- Idempotent, so it is safe to run before every migration pass.
--
-- ---------------------------------------------------------------------------
-- WHY uuidv7() IS DEFINED HERE RATHER THAN ASSUMED
--
-- `uuidv7()` is BUILT IN ONLY FROM POSTGRESQL 18. docs/DATABASE.md §1 specifies
-- "PostgreSQL 16+" and both candidate providers for decision D-01a (Neon and
-- Supabase) run 16/17 — so on the documented engine floor, and on the hosts we are
-- most likely to choose, the function does not exist and NOTHING can be inserted.
--
-- The integration-check script previously papered over this with a
-- `gen_random_uuid()` shim. That makes the schema apply, but it silently discards the
-- one property the choice was made for: docs/DATABASE.md §1 selects UUIDv7 because it
-- is "Time-sortable (so it indexes well and orders naturally)". A random v4 masquerading
-- as v7 gives random B-tree insertion points and page splits across every table in the
-- system — a performance characteristic that would only show up under production
-- volume, long after the cause was forgotten.
--
-- So this defines a REAL, time-sortable v7 in SQL, and only when the server does not
-- already provide one. On 18+ the built-in wins and this is a no-op.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- pgcrypto is not required for gen_random_uuid() on PG 13+, where it is core.
-- Requested anyway so the bootstrap also works on older installs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $bootstrap$
BEGIN
  -- Skip entirely when the server already has a native uuidv7 (PostgreSQL 18+).
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'uuidv7'
      AND n.nspname = 'pg_catalog'
  ) THEN
    RAISE NOTICE 'uuidv7(): using the server built-in.';
    RETURN;
  END IF;

  RAISE NOTICE 'uuidv7(): server has no built-in, installing a time-sortable SQL implementation.';

  /*
   * RFC 9562 §5.7 layout:
   *
   *   bits   0- 47  unix_ts_ms   big-endian milliseconds since the epoch
   *   bits  48- 51  version      literal 0111 (7)
   *   bits  52- 63  rand_a       random
   *   bits  64- 65  variant      literal 10
   *   bits  66-127  rand_b       random
   *
   * Built by taking a v4 (which is already correctly random everywhere except the
   * version and variant nibbles), overwriting the leading 6 bytes with the current
   * millisecond timestamp, and then rewriting the version nibble to 7. The variant
   * bits are already 10 in a v4, so they need no change.
   *
   * `clock_timestamp()` rather than `now()`: `now()` is fixed for the whole
   * transaction, so a batch insert would emit rows sharing a timestamp prefix and
   * lose ordering within the batch.
   */
  CREATE OR REPLACE FUNCTION public.uuidv7() RETURNS uuid
  LANGUAGE sql VOLATILE PARALLEL SAFE
  AS $fn$
    SELECT encode(
             overlay(
               overlay(
                 uuid_send(gen_random_uuid())
                 -- Leading 48 bits := big-endian unix milliseconds. int8send yields 8
                 -- bytes; bytes 3..8 are the low 48 bits.
                 PLACING substring(
                           int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint)
                           FROM 3 FOR 6)
                 FROM 1 FOR 6)
               -- Byte 7 := version nibble 7 in the high half, keeping the low half of
               -- the random byte so rand_a stays random.
               PLACING set_byte(
                         '\x00'::bytea, 0,
                         112 -- 0x70
                         | (get_byte(uuid_send(gen_random_uuid()), 6) & 15))
               FROM 7 FOR 1),
             'hex')::uuid
  $fn$;

  COMMENT ON FUNCTION public.uuidv7() IS
    'RFC 9562 UUIDv7. Fallback for PostgreSQL < 18, which has no built-in. Time-sortable: see db/bootstrap.sql.';
END
$bootstrap$;
