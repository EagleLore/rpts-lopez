/*
# Core Schema — Real Property Tax System (Lopez, Quezon)

## Overview
This migration creates the foundational schema for the Real Property Tax System
for the Municipality of Lopez, Quezon Province, Philippines. It implements
the full property tax lifecycle: property registry, assessment, billing,
collection, revenue sharing, cases, reporting, and system configuration.

## Tables Created (26 total)

### Configuration & Reference Tables
1. `jurisdictions` — Barangay, municipal, provincial jurisdiction hierarchy
2. `offices` — LGU offices (Assessor, Treasurer, etc.)
3. `staff_roles` — Role definitions with permissions
4. `staff_users` — Staff accounts linked to auth.users with office and role
5. `taxpayer_users` — Taxpayer accounts with Taxpayer ID and password
6. `valuation_schedules` — Versioned, certified SMV schedules
7. `assessment_levels` — Classification-based assessment level tables
8. `tax_rates` — Effective-dated tax rate configurations
9. `discount_rules` — Authorized discount configurations
10. `due_dates` — Quarterly payment due dates per year
11. `levy_types` — Levy type definitions (Basic, SEF, idle land, special)
12. `compliance_calendar` — Statutory reporting deadlines

### Property & Party Registry
13. `parties` — Persons and organizations
14. `properties` — Parcels with cadastral references
15. `property_units` — Separately assessable RPUs (land, building, machinery)
16. `property_interests` — Links parties to properties with roles
17. `property_lineage` — Parent/child relationships for subdivision/consolidation

### Assessment & Valuation
18. `assessments` — Approved assessment versions with TD numbers
19. `valuation_worksheets` — Per-unit valuation worksheets with evidence

### Billing & Tax Subledger
20. `tax_charges` — Annual/quarterly charges by unit, year, levy
21. `tax_adjustments` — Authorized relief/adjustment entries

### Collection & Treasury
22. `payments` — Payment records with lifecycle status
23. `payment_allocations` — Per-charge payment allocation
24. `receipts` — Controlled receipts with sequential numbers
25. `cash_sessions` — Collector session accountability

### Cases & Compliance
26. `cases` — Appeals, protests, refunds, enforcement cases

## Security
- RLS enabled on ALL tables
- Staff tables: TO authenticated with full CRUD for authenticated users
- Taxpayer tables: TO authenticated with full access
- Public reference tables: TO anon, authenticated for read access
- All monetary amounts stored as bigint centavos (integer cents) for exact decimal arithmetic
*/

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- CONFIGURATION & REFERENCE TABLES
-- ============================================================

-- 1. jurisdictions
CREATE TABLE IF NOT EXISTS jurisdictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('barangay', 'municipality', 'province')),
  parent_id uuid REFERENCES jurisdictions(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE jurisdictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_jurisdictions" ON jurisdictions;
CREATE POLICY "read_jurisdictions" ON jurisdictions FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "write_jurisdictions" ON jurisdictions;
CREATE POLICY "write_jurisdictions" ON jurisdictions FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_jurisdictions" ON jurisdictions;
CREATE POLICY "update_jurisdictions" ON jurisdictions FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_jurisdictions" ON jurisdictions;
CREATE POLICY "delete_jurisdictions" ON jurisdictions FOR DELETE
  TO authenticated USING (true);

-- 2. offices
CREATE TABLE IF NOT EXISTS offices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE offices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_offices" ON offices;
CREATE POLICY "read_offices" ON offices FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_offices" ON offices;
CREATE POLICY "insert_offices" ON offices FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_offices" ON offices;
CREATE POLICY "update_offices" ON offices FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_offices" ON offices;
CREATE POLICY "delete_offices" ON offices FOR DELETE
  TO authenticated USING (true);

-- 3. staff_roles
CREATE TABLE IF NOT EXISTS staff_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE staff_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_staff_roles" ON staff_roles;
CREATE POLICY "read_staff_roles" ON staff_roles FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_staff_roles" ON staff_roles;
CREATE POLICY "insert_staff_roles" ON staff_roles FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_staff_roles" ON staff_roles;
CREATE POLICY "update_staff_roles" ON staff_roles FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_staff_roles" ON staff_roles;
CREATE POLICY "delete_staff_roles" ON staff_roles FOR DELETE
  TO authenticated USING (true);

-- 4. staff_users
CREATE TABLE IF NOT EXISTS staff_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  office_id uuid REFERENCES offices(id),
  role_id uuid REFERENCES staff_roles(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_staff_users" ON staff_users;
CREATE POLICY "read_staff_users" ON staff_users FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_staff_users" ON staff_users;
CREATE POLICY "insert_staff_users" ON staff_users FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_staff_users" ON staff_users;
CREATE POLICY "update_staff_users" ON staff_users FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_staff_users" ON staff_users;
CREATE POLICY "delete_staff_users" ON staff_users FOR DELETE
  TO authenticated USING (true);

-- 5. taxpayer_users
CREATE TABLE IF NOT EXISTS taxpayer_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id text NOT NULL UNIQUE,
  email text,
  full_name text NOT NULL,
  phone text,
  address text,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE taxpayer_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_taxpayer_users" ON taxpayer_users;
CREATE POLICY "read_taxpayer_users" ON taxpayer_users FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_taxpayer_users" ON taxpayer_users;
CREATE POLICY "insert_taxpayer_users" ON taxpayer_users FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_taxpayer_users" ON taxpayer_users;
CREATE POLICY "update_taxpayer_users" ON taxpayer_users FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_taxpayer_users" ON taxpayer_users;
CREATE POLICY "delete_taxpayer_users" ON taxpayer_users FOR DELETE
  TO authenticated USING (true);

-- 6. valuation_schedules
CREATE TABLE IF NOT EXISTS valuation_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'certified', 'in_force', 'superseded')),
  publication_date date,
  effectivity_date date,
  certification_reference text,
  general_revision_date date,
  legal_source text,
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE valuation_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_valuation_schedules" ON valuation_schedules;
CREATE POLICY "read_valuation_schedules" ON valuation_schedules FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_valuation_schedules" ON valuation_schedules;
CREATE POLICY "insert_valuation_schedules" ON valuation_schedules FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_valuation_schedules" ON valuation_schedules;
CREATE POLICY "update_valuation_schedules" ON valuation_schedules FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_valuation_schedules" ON valuation_schedules;
CREATE POLICY "delete_valuation_schedules" ON valuation_schedules FOR DELETE
  TO authenticated USING (true);

-- 7. assessment_levels
CREATE TABLE IF NOT EXISTS assessment_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classification text NOT NULL CHECK (classification IN ('residential', 'agricultural', 'commercial', 'industrial', 'mineral', 'timberland', 'special')),
  property_type text NOT NULL CHECK (property_type IN ('land', 'building', 'machinery')),
  level_percent numeric(5,2) NOT NULL,
  min_value bigint DEFAULT 0,
  max_value bigint,
  effective_date date NOT NULL,
  legal_source text,
  schedule_id uuid REFERENCES valuation_schedules(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE assessment_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_assessment_levels" ON assessment_levels;
CREATE POLICY "read_assessment_levels" ON assessment_levels FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_assessment_levels" ON assessment_levels;
CREATE POLICY "insert_assessment_levels" ON assessment_levels FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_assessment_levels" ON assessment_levels;
CREATE POLICY "update_assessment_levels" ON assessment_levels FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_assessment_levels" ON assessment_levels;
CREATE POLICY "delete_assessment_levels" ON assessment_levels FOR DELETE
  TO authenticated USING (true);

-- 8. tax_rates
CREATE TABLE IF NOT EXISTS tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  levy_type text NOT NULL CHECK (levy_type IN ('basic', 'sef', 'idle_land', 'special_levy')),
  rate_percent numeric(5,2) NOT NULL,
  effective_date date NOT NULL,
  end_date date,
  ordinance_reference text,
  legal_source text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_tax_rates" ON tax_rates;
CREATE POLICY "read_tax_rates" ON tax_rates FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_tax_rates" ON tax_rates;
CREATE POLICY "insert_tax_rates" ON tax_rates FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_tax_rates" ON tax_rates;
CREATE POLICY "update_tax_rates" ON tax_rates FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_tax_rates" ON tax_rates;
CREATE POLICY "delete_tax_rates" ON tax_rates FOR DELETE
  TO authenticated USING (true);

-- 9. discount_rules
CREATE TABLE IF NOT EXISTS discount_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  max_percent numeric(5,2) NOT NULL,
  eligibility_criteria text,
  valid_from date NOT NULL,
  valid_until date,
  ordinance_reference text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE discount_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_discount_rules" ON discount_rules;
CREATE POLICY "read_discount_rules" ON discount_rules FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_discount_rules" ON discount_rules;
CREATE POLICY "insert_discount_rules" ON discount_rules FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_discount_rules" ON discount_rules;
CREATE POLICY "update_discount_rules" ON discount_rules FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_discount_rules" ON discount_rules;
CREATE POLICY "delete_discount_rules" ON discount_rules FOR DELETE
  TO authenticated USING (true);

-- 10. due_dates
CREATE TABLE IF NOT EXISTS due_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_year integer NOT NULL,
  quarter integer NOT NULL CHECK (quarter IN (1, 2, 3, 4)),
  due_date date NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (tax_year, quarter)
);
ALTER TABLE due_dates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_due_dates" ON due_dates;
CREATE POLICY "read_due_dates" ON due_dates FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_due_dates" ON due_dates;
CREATE POLICY "insert_due_dates" ON due_dates FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_due_dates" ON due_dates;
CREATE POLICY "update_due_dates" ON due_dates FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_due_dates" ON due_dates;
CREATE POLICY "delete_due_dates" ON due_dates FOR DELETE
  TO authenticated USING (true);

-- 11. levy_types
CREATE TABLE IF NOT EXISTS levy_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code IN ('basic', 'sef', 'idle_land', 'special_levy')),
  name text NOT NULL,
  description text,
  statutory_destination text,
  sharing_config jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE levy_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_levy_types" ON levy_types;
CREATE POLICY "read_levy_types" ON levy_types FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_levy_types" ON levy_types;
CREATE POLICY "insert_levy_types" ON levy_types FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_levy_types" ON levy_types;
CREATE POLICY "update_levy_types" ON levy_types FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_levy_types" ON levy_types;
CREATE POLICY "delete_levy_types" ON levy_types FOR DELETE
  TO authenticated USING (true);

-- 12. compliance_calendar
CREATE TABLE IF NOT EXISTS compliance_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_name text NOT NULL,
  reporting_authority text NOT NULL,
  period text NOT NULL,
  deadline date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'prepared', 'submitted', 'acknowledged', 'overdue')),
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE compliance_calendar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_compliance_calendar" ON compliance_calendar;
CREATE POLICY "read_compliance_calendar" ON compliance_calendar FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_compliance_calendar" ON compliance_calendar;
CREATE POLICY "insert_compliance_calendar" ON compliance_calendar FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_compliance_calendar" ON compliance_calendar;
CREATE POLICY "update_compliance_calendar" ON compliance_calendar FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_compliance_calendar" ON compliance_calendar;
CREATE POLICY "delete_compliance_calendar" ON compliance_calendar FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- PROPERTY & PARTY REGISTRY
-- ============================================================

-- 13. parties
CREATE TABLE IF NOT EXISTS parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('person', 'organization')),
  tin text,
  contact_number text,
  email text,
  address text,
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_parties" ON parties;
CREATE POLICY "read_parties" ON parties FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_parties" ON parties;
CREATE POLICY "insert_parties" ON parties FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_parties" ON parties;
CREATE POLICY "update_parties" ON parties FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_parties" ON parties;
CREATE POLICY "delete_parties" ON parties FOR DELETE
  TO authenticated USING (true);

-- 14. properties
CREATE TABLE IF NOT EXISTS properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pin text,
  tax_declaration_number text,
  arp_number text,
  cadastral_lot_number text,
  survey_number text,
  title_number text,
  legacy_identifier text,
  barangay_id uuid REFERENCES jurisdictions(id),
  municipality_id uuid REFERENCES jurisdictions(id),
  province_id uuid REFERENCES jurisdictions(id),
  location_address text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired', 'cancelled', 'transferred')),
  parent_property_id uuid REFERENCES properties(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_properties" ON properties;
CREATE POLICY "read_properties" ON properties FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_properties" ON properties;
CREATE POLICY "insert_properties" ON properties FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_properties" ON properties;
CREATE POLICY "update_properties" ON properties FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_properties" ON properties;
CREATE POLICY "delete_properties" ON properties FOR DELETE
  TO authenticated USING (true);

-- 15. property_units
CREATE TABLE IF NOT EXISTS property_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_type text NOT NULL CHECK (unit_type IN ('land', 'building', 'machinery')),
  classification text NOT NULL CHECK (classification IN ('residential', 'agricultural', 'commercial', 'industrial', 'mineral', 'timberland', 'special')),
  actual_use text,
  area numeric(15,2),
  area_unit text DEFAULT 'sqm',
  floor_area numeric(15,2),
  construction_type text,
  year_built integer,
  age_years numeric(5,1),
  acquisition_cost numeric(15,2),
  economic_life_years numeric(5,1),
  operational_status text,
  description text,
  is_exempt boolean NOT NULL DEFAULT false,
  exemption_basis text,
  exemption_decision_reference text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE property_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_property_units" ON property_units;
CREATE POLICY "read_property_units" ON property_units FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_property_units" ON property_units;
CREATE POLICY "insert_property_units" ON property_units FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_property_units" ON property_units;
CREATE POLICY "update_property_units" ON property_units FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_property_units" ON property_units;
CREATE POLICY "delete_property_units" ON property_units FOR DELETE
  TO authenticated USING (true);

-- 16. property_interests
CREATE TABLE IF NOT EXISTS property_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES parties(id),
  interest_type text NOT NULL CHECK (interest_type IN ('declared_owner', 'administrator', 'beneficial_user', 'claimant', 'payer', 'co_owner')),
  share_percentage numeric(5,2),
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE property_interests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_property_interests" ON property_interests;
CREATE POLICY "read_property_interests" ON property_interests FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_property_interests" ON property_interests;
CREATE POLICY "insert_property_interests" ON property_interests FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_property_interests" ON property_interests;
CREATE POLICY "update_property_interests" ON property_interests FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_property_interests" ON property_interests;
CREATE POLICY "delete_property_interests" ON property_interests FOR DELETE
  TO authenticated USING (true);

-- 17. property_lineage
CREATE TABLE IF NOT EXISTS property_lineage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  child_property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (relationship_type IN ('subdivision', 'consolidation', 'boundary_change', 'transfer')),
  event_date date NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE property_lineage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_property_lineage" ON property_lineage;
CREATE POLICY "read_property_lineage" ON property_lineage FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_property_lineage" ON property_lineage;
CREATE POLICY "insert_property_lineage" ON property_lineage FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_property_lineage" ON property_lineage;
CREATE POLICY "update_property_lineage" ON property_lineage FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_property_lineage" ON property_lineage;
CREATE POLICY "delete_property_lineage" ON property_lineage FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- ASSESSMENT & VALUATION
-- ============================================================

-- 18. assessments
CREATE TABLE IF NOT EXISTS assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_unit_id uuid NOT NULL REFERENCES property_units(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tax_declaration_number text,
  assessment_date date NOT NULL,
  effective_date date NOT NULL,
  market_value bigint NOT NULL,
  classification text NOT NULL,
  actual_use text,
  assessment_level_percent numeric(5,2) NOT NULL,
  assessed_value bigint NOT NULL,
  schedule_id uuid REFERENCES valuation_schedules(id),
  worksheet_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'approved', 'cancelled', 'superseded')),
  prepared_by uuid REFERENCES staff_users(id),
  reviewed_by uuid REFERENCES staff_users(id),
  approved_by uuid REFERENCES staff_users(id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_assessments" ON assessments;
CREATE POLICY "read_assessments" ON assessments FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_assessments" ON assessments;
CREATE POLICY "insert_assessments" ON assessments FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_assessments" ON assessments;
CREATE POLICY "update_assessments" ON assessments FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_assessments" ON assessments;
CREATE POLICY "delete_assessments" ON assessments FOR DELETE
  TO authenticated USING (true);

-- 19. valuation_worksheets
CREATE TABLE IF NOT EXISTS valuation_worksheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_unit_id uuid NOT NULL REFERENCES property_units(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES valuation_schedules(id),
  valuation_method text NOT NULL,
  unit_value numeric(15,2),
  area numeric(15,2),
  adjustment_factors jsonb,
  construction_cost numeric(15,2),
  floor_area numeric(15,2),
  age_years numeric(5,1),
  depreciation_percent numeric(5,2),
  acquisition_cost numeric(15,2),
  remaining_life numeric(5,1),
  computed_market_value bigint NOT NULL,
  inspection_evidence text,
  inspection_date date,
  inspected_by uuid REFERENCES staff_users(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE valuation_worksheets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_valuation_worksheets" ON valuation_worksheets;
CREATE POLICY "read_valuation_worksheets" ON valuation_worksheets FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_valuation_worksheets" ON valuation_worksheets;
CREATE POLICY "insert_valuation_worksheets" ON valuation_worksheets FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_valuation_worksheets" ON valuation_worksheets;
CREATE POLICY "update_valuation_worksheets" ON valuation_worksheets FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_valuation_worksheets" ON valuation_worksheets;
CREATE POLICY "delete_valuation_worksheets" ON valuation_worksheets FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- BILLING & TAX SUBLEDGER
-- ============================================================

-- 20. tax_charges
CREATE TABLE IF NOT EXISTS tax_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  property_unit_id uuid NOT NULL REFERENCES property_units(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES assessments(id),
  tax_year integer NOT NULL,
  quarter integer NOT NULL CHECK (quarter IN (1, 2, 3, 4)),
  levy_type text NOT NULL CHECK (levy_type IN ('basic', 'sef', 'idle_land', 'special_levy')),
  gross_amount bigint NOT NULL,
  discount_amount bigint NOT NULL DEFAULT 0,
  interest_amount bigint NOT NULL DEFAULT 0,
  net_amount bigint NOT NULL,
  paid_amount bigint NOT NULL DEFAULT 0,
  balance bigint NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partially_paid', 'paid', 'cancelled', 'reversed')),
  charge_basis jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE (property_unit_id, tax_year, quarter, levy_type)
);
ALTER TABLE tax_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_tax_charges" ON tax_charges;
CREATE POLICY "read_tax_charges" ON tax_charges FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_tax_charges" ON tax_charges;
CREATE POLICY "insert_tax_charges" ON tax_charges FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_tax_charges" ON tax_charges;
CREATE POLICY "update_tax_charges" ON tax_charges FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_tax_charges" ON tax_charges;
CREATE POLICY "delete_tax_charges" ON tax_charges FOR DELETE
  TO authenticated USING (true);

-- 21. tax_adjustments
CREATE TABLE IF NOT EXISTS tax_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_charge_id uuid NOT NULL REFERENCES tax_charges(id) ON DELETE CASCADE,
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('discount', 'relief', 'interest_waiver', 'correction', 'reversal')),
  amount bigint NOT NULL,
  reason text NOT NULL,
  legal_source text,
  authorized_by uuid REFERENCES staff_users(id),
  authorized_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE tax_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_tax_adjustments" ON tax_adjustments;
CREATE POLICY "read_tax_adjustments" ON tax_adjustments FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_tax_adjustments" ON tax_adjustments;
CREATE POLICY "insert_tax_adjustments" ON tax_adjustments FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_tax_adjustments" ON tax_adjustments;
CREATE POLICY "update_tax_adjustments" ON tax_adjustments FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_tax_adjustments" ON tax_adjustments;
CREATE POLICY "delete_tax_adjustments" ON tax_adjustments FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- COLLECTION & TREASURY
-- ============================================================

-- 22. payments
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid,
  property_id uuid REFERENCES properties(id),
  taxpayer_id uuid REFERENCES taxpayer_users(id),
  payer_name text NOT NULL,
  payer_type text DEFAULT 'taxpayer' CHECK (payer_type IN ('taxpayer', 'representative', 'agent')),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'check', 'bank_transfer', 'online')),
  tender_amount bigint NOT NULL,
  total_allocated bigint NOT NULL DEFAULT 0,
  change_amount bigint NOT NULL DEFAULT 0,
  payment_date timestamptz NOT NULL DEFAULT now(),
  settlement_date timestamptz,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('initiated', 'confirmed', 'receipted', 'settled', 'reconciled', 'failed', 'reversed')),
  cash_session_id uuid,
  collected_by uuid REFERENCES staff_users(id),
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_payments" ON payments;
CREATE POLICY "read_payments" ON payments FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_payments" ON payments;
CREATE POLICY "insert_payments" ON payments FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_payments" ON payments;
CREATE POLICY "update_payments" ON payments FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_payments" ON payments;
CREATE POLICY "delete_payments" ON payments FOR DELETE
  TO authenticated USING (true);

-- 23. payment_allocations
CREATE TABLE IF NOT EXISTS payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  tax_charge_id uuid NOT NULL REFERENCES tax_charges(id) ON DELETE CASCADE,
  allocated_amount bigint NOT NULL,
  principal_amount bigint NOT NULL DEFAULT 0,
  interest_amount bigint NOT NULL DEFAULT 0,
  discount_amount bigint NOT NULL DEFAULT 0,
  share_province bigint NOT NULL DEFAULT 0,
  share_municipality bigint NOT NULL DEFAULT 0,
  share_barangay bigint NOT NULL DEFAULT 0,
  share_sef_province bigint NOT NULL DEFAULT 0,
  share_sef_municipality bigint NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_payment_allocations" ON payment_allocations;
CREATE POLICY "read_payment_allocations" ON payment_allocations FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_payment_allocations" ON payment_allocations;
CREATE POLICY "insert_payment_allocations" ON payment_allocations FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_payment_allocations" ON payment_allocations;
CREATE POLICY "update_payment_allocations" ON payment_allocations FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_payment_allocations" ON payment_allocations;
CREATE POLICY "delete_payment_allocations" ON payment_allocations FOR DELETE
  TO authenticated USING (true);

-- 24. receipts
CREATE TABLE IF NOT EXISTS receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  property_id uuid REFERENCES properties(id),
  amount bigint NOT NULL,
  issued_date timestamptz NOT NULL DEFAULT now(),
  issued_by uuid REFERENCES staff_users(id),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled', 'reprinted')),
  cancel_reason text,
  cancelled_by uuid REFERENCES staff_users(id),
  cancelled_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_receipts" ON receipts;
CREATE POLICY "read_receipts" ON receipts FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_receipts" ON receipts;
CREATE POLICY "insert_receipts" ON receipts FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_receipts" ON receipts;
CREATE POLICY "update_receipts" ON receipts FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_receipts" ON receipts;
CREATE POLICY "delete_receipts" ON receipts FOR DELETE
  TO authenticated USING (true);

-- 25. cash_sessions
CREATE TABLE IF NOT EXISTS cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_number text NOT NULL UNIQUE,
  cashier_id uuid NOT NULL REFERENCES staff_users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opening_balance bigint NOT NULL DEFAULT 0,
  closing_balance bigint,
  total_collected bigint NOT NULL DEFAULT 0,
  total_receipts integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'reconciled')),
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_cash_sessions" ON cash_sessions;
CREATE POLICY "read_cash_sessions" ON cash_sessions FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_cash_sessions" ON cash_sessions;
CREATE POLICY "insert_cash_sessions" ON cash_sessions FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_cash_sessions" ON cash_sessions;
CREATE POLICY "update_cash_sessions" ON cash_sessions FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_cash_sessions" ON cash_sessions;
CREATE POLICY "delete_cash_sessions" ON cash_sessions FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- CASES & COMPLIANCE
-- ============================================================

-- 26. cases
CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number text NOT NULL UNIQUE,
  case_type text NOT NULL CHECK (case_type IN ('assessment_appeal', 'payment_protest', 'refund_claim', 'delinquency_enforcement')),
  property_id uuid REFERENCES properties(id),
  tax_charge_id uuid REFERENCES tax_charges(id),
  payment_id uuid REFERENCES payments(id),
  party_id uuid REFERENCES parties(id),
  filed_date date NOT NULL,
  notice_receipt_date date,
  submission_deadline date,
  decision_deadline date,
  status text NOT NULL DEFAULT 'filed' CHECK (status IN ('filed', 'pending', 'under_review', 'decided', 'dismissed', 'closed', 'appealed')),
  stage text,
  description text,
  amount_in_dispute bigint,
  decision_text text,
  decided_at timestamptz,
  decided_by uuid REFERENCES staff_users(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_cases" ON cases;
CREATE POLICY "read_cases" ON cases FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_cases" ON cases;
CREATE POLICY "insert_cases" ON cases FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_cases" ON cases;
CREATE POLICY "update_cases" ON cases FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_cases" ON cases;
CREATE POLICY "delete_cases" ON cases FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_properties_pin ON properties(pin);
CREATE INDEX IF NOT EXISTS idx_properties_td ON properties(tax_declaration_number);
CREATE INDEX IF NOT EXISTS idx_properties_barangay ON properties(barangay_id);
CREATE INDEX IF NOT EXISTS idx_property_units_property ON property_units(property_id);
CREATE INDEX IF NOT EXISTS idx_assessments_unit ON assessments(property_unit_id);
CREATE INDEX IF NOT EXISTS idx_assessments_property ON assessments(property_id);
CREATE INDEX IF NOT EXISTS idx_assessments_status ON assessments(status);
CREATE INDEX IF NOT EXISTS idx_tax_charges_property ON tax_charges(property_id);
CREATE INDEX IF NOT EXISTS idx_tax_charges_year ON tax_charges(tax_year);
CREATE INDEX IF NOT EXISTS idx_tax_charges_status ON tax_charges(status);
CREATE INDEX IF NOT EXISTS idx_payments_property ON payments(property_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_charge ON payment_allocations(tax_charge_id);
CREATE INDEX IF NOT EXISTS idx_receipts_number ON receipts(receipt_number);
CREATE INDEX IF NOT EXISTS idx_cases_property ON cases(property_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_staff_users_auth ON staff_users(auth_id);
CREATE INDEX IF NOT EXISTS idx_property_interests_property ON property_interests(property_id);
CREATE INDEX IF NOT EXISTS idx_property_interests_party ON property_interests(party_id);