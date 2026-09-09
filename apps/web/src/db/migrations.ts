/**
 * Schema migrations as idempotent SQL, applied in order at start-up. Statements
 * are embedded rather than read from disk so they survive bundling. Append new
 * entries; never edit an applied one.
 */
export const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: "0000_init",
    sql: `
CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  customer_id text NOT NULL,
  access_token text NOT NULL,
  status text NOT NULL,
  engineering_status text NOT NULL,
  payment_status text NOT NULL,
  customer_name text,
  customer_email text,
  customer_phone text,
  purpose text NOT NULL,
  postcode text NOT NULL,
  budget_cents integer,
  timeframe text,
  needs_installation boolean NOT NULL DEFAULT false,
  referral_source text,
  template_id text NOT NULL,
  current_design_version integer NOT NULL DEFAULT 1,
  confirmed_design_version integer,
  quoted_design_version integer,
  approved_design_version integer,
  factory_id text NOT NULL,
  factory_version integer NOT NULL,
  price_list_id text NOT NULL,
  price_list_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_customer ON orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_status ON orders (status);

CREATE TABLE IF NOT EXISTS design_versions (
  id text PRIMARY KEY,
  order_id text NOT NULL,
  version integer NOT NULL,
  design jsonb NOT NULL,
  measurement jsonb,
  engineering jsonb NOT NULL,
  engineering_hash text,
  verdict text,
  created_by text NOT NULL,
  note text,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS design_versions_order_version ON design_versions (order_id, version);

CREATE TABLE IF NOT EXISTS reviews (
  id text PRIMARY KEY,
  order_id text NOT NULL,
  design_version integer NOT NULL,
  decision text NOT NULL,
  notes text NOT NULL,
  reviewer text NOT NULL,
  rule_set_version text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes (
  id text PRIMARY KEY,
  order_id text NOT NULL,
  design_version integer NOT NULL,
  engineering_hash text NOT NULL,
  price jsonb NOT NULL,
  total_cents integer NOT NULL,
  delivery_cents integer NOT NULL,
  deposit_cents integer NOT NULL,
  price_list_id text NOT NULL,
  price_list_version integer NOT NULL,
  factory_id text NOT NULL,
  factory_version integer NOT NULL,
  lead_time_days integer NOT NULL,
  notes text,
  status text NOT NULL,
  issued_by text NOT NULL,
  issued_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  accepted_at timestamptz
);
CREATE INDEX IF NOT EXISTS quotes_order ON quotes (order_id);

CREATE TABLE IF NOT EXISTS confirmations (
  id text PRIMARY KEY,
  order_id text NOT NULL,
  design_version integer NOT NULL,
  quote_id text NOT NULL,
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  acknowledgements jsonb NOT NULL,
  confirmed_by text NOT NULL,
  confirmed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  order_id text NOT NULL,
  idempotency_key text NOT NULL,
  kind text NOT NULL,
  amount_cents integer NOT NULL,
  method text NOT NULL,
  reference text,
  note text,
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency ON payments (idempotency_key);

CREATE TABLE IF NOT EXISTS releases (
  release_key text PRIMARY KEY,
  order_id text NOT NULL,
  design_version integer NOT NULL,
  sequence integer NOT NULL,
  payload jsonb NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL,
  released_by text NOT NULL,
  released_at timestamptz NOT NULL,
  stopped_reason text
);
CREATE INDEX IF NOT EXISTS releases_order ON releases (order_id);

CREATE TABLE IF NOT EXISTS production_events (
  id text PRIMARY KEY,
  order_id text NOT NULL,
  release_key text,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS production_events_order ON production_events (order_id);

CREATE TABLE IF NOT EXISTS service_cases (
  id text PRIMARY KEY,
  order_id text NOT NULL,
  release_key text,
  part_ref text NOT NULL,
  part_kind text NOT NULL,
  severity text NOT NULL,
  symptom text NOT NULL,
  photo_refs jsonb NOT NULL,
  cause text,
  responsibility text,
  resolution text,
  cost_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  opened_by text NOT NULL,
  created_at timestamptz NOT NULL,
  responded_at timestamptz,
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS cost_records (
  id text PRIMARY KEY,
  order_id text NOT NULL,
  category text NOT NULL,
  amount_cents integer NOT NULL,
  minutes integer,
  note text,
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS service_areas (
  postcode text PRIMARY KEY,
  zone text NOT NULL,
  label text NOT NULL
);

CREATE TABLE IF NOT EXISTS enquiries (
  id text PRIMARY KEY,
  purpose text NOT NULL,
  postcode text NOT NULL,
  budget_cents integer,
  timeframe text,
  needs_installation boolean NOT NULL DEFAULT false,
  reasons jsonb NOT NULL,
  contact text,
  notes text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL
);
`,
  },
  {
    id: "0001_replacement_and_media",
    sql: `
ALTER TABLE releases ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'production';
ALTER TABLE releases ADD COLUMN IF NOT EXISTS source_release_key text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS service_case_id text;
CREATE TABLE IF NOT EXISTS media (
  id text PRIMARY KEY,
  order_id text NOT NULL,
  kind text NOT NULL,
  original_name text NOT NULL,
  mime text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS media_order ON media (order_id);
`,
  },
];
