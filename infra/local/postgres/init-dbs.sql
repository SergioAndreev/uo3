-- Initialize isolated development (uo3_dev) and test (uo3_test) databases
-- Note: POSTGRES_DB=uo3_dev is created automatically by the postgres entrypoint.

SELECT 'CREATE DATABASE uo3_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'uo3_test')\gexec

\connect uo3_dev
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\connect uo3_test
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
