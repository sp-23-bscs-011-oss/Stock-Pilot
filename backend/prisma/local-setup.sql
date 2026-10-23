-- One-time local setup for a native PostgreSQL install (not needed with docker compose).
-- Run as the postgres superuser:
--   psql -U postgres -f backend/prisma/local-setup.sql
-- CREATEDB lets `prisma migrate dev` create its temporary shadow database.
CREATE ROLE stockpilot WITH LOGIN PASSWORD 'stockpilot' CREATEDB;
CREATE DATABASE stockpilot OWNER stockpilot;
CREATE DATABASE stockpilot_test OWNER stockpilot;
