CREATE TABLE login_otp_challenges (
  token_hash TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  return_to TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX login_otp_email_created_idx
  ON login_otp_challenges(LOWER(email), created_at DESC);
CREATE INDEX login_otp_active_idx
  ON login_otp_challenges(token_hash, expires_at)
  WHERE used_at IS NULL;
