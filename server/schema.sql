CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('engineer', 'operator')),
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

INSERT INTO users (name, email, password_hash, role)
VALUES
  ('Thibaut', 'test+thibaut@decathlon.com', NULL, 'operator'),
  ('Nathan', 'test+nathan@decathlon.com', NULL, 'operator'),
  ('Estelle', 'test+estelle@decathlon.com', NULL, 'operator'),
  ('Louise', 'test+louise@decathlon.com', NULL, 'operator'),
  ('Nicolas', 'test+nicolas@decathlon.com', NULL, 'operator')
ON CONFLICT (email) DO NOTHING;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_expiration_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS test_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id),
  product_reference TEXT NOT NULL CHECK (char_length(product_reference) BETWEEN 1 AND 120),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  test_family TEXT NOT NULL CHECK (test_family IN ('Impact', 'Thermique', 'Mécanique')),
  product_category TEXT CHECK (
    product_category IS NULL OR
    product_category IN ('Body protection', 'maintien articulaire', 'casque')
  ),
  due_date DATE NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'scheduled', 'in_progress', 'pending_validation', 'done')),
  assigned_operator_id UUID REFERENCES users(id),
  scheduled_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE test_requests
  ADD COLUMN IF NOT EXISTS product_category TEXT CHECK (
    product_category IS NULL OR
    product_category IN ('Body protection', 'maintien articulaire', 'casque')
  );

CREATE INDEX IF NOT EXISTS test_requests_requester_idx
  ON test_requests (requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS test_requests_queue_idx
  ON test_requests (status, due_date);

CREATE TABLE IF NOT EXISTS test_results (
  request_id UUID PRIMARY KEY REFERENCES test_requests(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('conforming', 'non_conforming')),
  comment TEXT NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 2000),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at TIMESTAMPTZ
);
