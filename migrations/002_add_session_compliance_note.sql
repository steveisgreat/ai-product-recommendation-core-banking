-- Migration: 002_add_session_compliance_note.sql
-- Adds session_compliance_note column to recommendations table.
-- Idempotent: uses ADD COLUMN IF NOT EXISTS (Postgres 9.6+).

ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS session_compliance_note TEXT NOT NULL DEFAULT '';
