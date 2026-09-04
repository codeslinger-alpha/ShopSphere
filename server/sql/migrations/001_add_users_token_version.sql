-- Run this once only if the users table already exists.
-- token_version increments on logout, invalidating all earlier JWTs for that user.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
