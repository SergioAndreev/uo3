CREATE DATABASE duskmarch_dev;
CREATE DATABASE duskmarch_test;
\connect duskmarch_dev
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
\connect duskmarch_test
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
