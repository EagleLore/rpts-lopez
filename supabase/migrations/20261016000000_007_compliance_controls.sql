-- Fail-closed legal configuration, role-scoped writes, and transactional RPT operations.
-- Existing illustrative configuration is disabled until local authority records are entered.

ALTER TABLE public.jurisdictions
  ADD COLUMN IF NOT EXISTS is_metro_manila boolean NOT NULL DEFAULT false;
ALTER TABLE public.jurisdictions DROP CONSTRAINT IF EXISTS jurisdictions_type_check;
ALTER TABLE public.jurisdictions ADD CONSTRAINT jurisdictions_type_check
  CHECK (type IN ('barangay', 'municipality', 'province', 'city'));
ALTER TABLE public.tax_rates
  ADD COLUMN IF NOT EXISTS jurisdiction_id uuid REFERENCES public.jurisdictions(id);
CREATE INDEX IF NOT EXISTS tax_rates_jurisdiction_levy_effective_idx
  ON public.tax_rates(jurisdiction_id, levy_type, effective_date DESC);

ALTER TABLE public.discount_rules DROP CONSTRAINT IF EXISTS discount_rules_max_percent_legal_limit;
ALTER TABLE public.discount_rules ADD CONSTRAINT discount_rules_max_percent_legal_limit
  CHECK (max_percent >= 0 AND max_percent <= 20);

UPDATE public.tax_rates
SET status = 'inactive'
WHERE COALESCE(ordinance_reference, '') ILIKE '%pending%'
   OR COALESCE(legal_source, '') ILIKE '%pending%';

UPDATE public.assessment_levels
SET status = 'inactive'
WHERE COALESCE(legal_source, '') ILIKE '%pending%';

UPDATE public.discount_rules
SET status = 'inactive'
WHERE COALESCE(name, '') ILIKE '%pending%'
   OR COALESCE(ordinance_reference, '') ILIKE '%pending%'
   OR COALESCE(eligibility_criteria, '') ILIKE '%pending%';

CREATE OR REPLACE FUNCTION public.has_staff_permission(required_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_users staff
    JOIN public.staff_roles role ON role.id = staff.role_id
    WHERE staff.auth_id = auth.uid()
      AND staff.is_active = true
      AND required_permission = ANY(role.permissions)
  );
$$;

REVOKE ALL ON FUNCTION public.has_staff_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_staff_permission(text) TO authenticated;

-- Replace the former all-active-staff CRUD policy with explicit write permissions.
DO $$
DECLARE
  table_name text;
  permission_name text;
  app_tables text[] := ARRAY[
    'jurisdictions', 'offices', 'valuation_schedules', 'assessment_levels',
    'tax_rates', 'discount_rules', 'due_dates', 'levy_types', 'compliance_calendar',
    'parties', 'properties', 'property_units', 'property_interests', 'property_lineage',
    'valuation_worksheets', 'assessments', 'tax_charges', 'tax_adjustments',
    'payments', 'payment_allocations', 'receipts', 'cash_sessions', 'cases'
  ];
BEGIN
  FOREACH table_name IN ARRAY app_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'staff_manage_' || table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'staff_read_' || table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'staff_insert_' || table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'staff_update_' || table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_staff_user())',
      'staff_read_' || table_name, table_name
    );

    permission_name := CASE
      WHEN table_name IN ('jurisdictions','offices','valuation_schedules','assessment_levels',
        'tax_rates','discount_rules','due_dates','levy_types','compliance_calendar') THEN 'configuration'
      WHEN table_name IN ('parties','properties','property_units','property_interests','property_lineage') THEN 'properties'
      WHEN table_name IN ('valuation_worksheets','assessments') THEN 'assessments'
      WHEN table_name IN ('tax_charges','tax_adjustments') THEN 'billing'
      WHEN table_name IN ('payments','payment_allocations','receipts','cash_sessions') THEN 'collection'
      WHEN table_name = 'cases' THEN 'cases'
      ELSE NULL
    END;

    IF permission_name IS NOT NULL
       AND table_name NOT IN ('tax_charges','payments','payment_allocations','receipts') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_staff_permission(%L))',
        'staff_insert_' || table_name, table_name, permission_name
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_staff_permission(%L)) WITH CHECK (public.has_staff_permission(%L))',
        'staff_update_' || table_name, table_name, permission_name, permission_name
      );
    END IF;
    -- There is deliberately no general DELETE policy. Financial and assessment history
    -- must be corrected by an authorized reversal/cancellation workflow, not erased.
  END LOOP;
END $$;

-- Append-only audit history for valuation, configuration, property, and financial changes.
CREATE TABLE IF NOT EXISTS public.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  actor_auth_id uuid,
  actor_staff_id uuid REFERENCES public.staff_users(id),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_read_finance_roles ON public.audit_events;
CREATE POLICY audit_events_read_finance_roles ON public.audit_events
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('reconciliation'));
GRANT SELECT ON public.audit_events TO authenticated;

CREATE OR REPLACE FUNCTION public.capture_rpt_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff_id uuid;
  v_record_id uuid;
BEGIN
  SELECT staff.id INTO v_staff_id FROM public.staff_users staff
  WHERE staff.auth_id = auth.uid() AND staff.is_active = true
  LIMIT 1;

  IF TG_OP = 'DELETE' THEN
    v_record_id := OLD.id;
    INSERT INTO public.audit_events (table_name, record_id, operation, actor_auth_id, actor_staff_id, old_data)
    VALUES (TG_TABLE_NAME, v_record_id, TG_OP, auth.uid(), v_staff_id, to_jsonb(OLD));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    v_record_id := NEW.id;
    INSERT INTO public.audit_events (table_name, record_id, operation, actor_auth_id, actor_staff_id, old_data, new_data)
    VALUES (TG_TABLE_NAME, v_record_id, TG_OP, auth.uid(), v_staff_id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSE
    v_record_id := NEW.id;
    INSERT INTO public.audit_events (table_name, record_id, operation, actor_auth_id, actor_staff_id, new_data)
    VALUES (TG_TABLE_NAME, v_record_id, TG_OP, auth.uid(), v_staff_id, to_jsonb(NEW));
    RETURN NEW;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_rpt_audit_event() FROM PUBLIC;

DO $$
DECLARE
  table_name text;
  audited_tables text[] := ARRAY[
    'jurisdictions','valuation_schedules','assessment_levels','tax_rates','discount_rules',
    'parties','properties','property_units','property_interests','valuation_worksheets',
    'assessments','tax_charges','tax_adjustments','payments','payment_allocations',
    'receipts','cash_sessions'
  ];
BEGIN
  FOREACH table_name IN ARRAY audited_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS rpt_audit_change ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER rpt_audit_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.capture_rpt_audit_event()',
      table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.validate_approved_assessment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_schedule_id uuid;
  v_unit_type text;
  v_worksheet public.valuation_worksheets%ROWTYPE;
BEGIN
  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT unit.unit_type INTO v_unit_type
  FROM public.property_units unit
  WHERE unit.id = NEW.property_unit_id AND unit.status = 'active';
  IF v_unit_type IS NULL THEN
    RAISE EXCEPTION 'Assessment requires an active property unit.';
  END IF;

  v_schedule_id := NEW.schedule_id;
  IF NEW.worksheet_id IS NOT NULL THEN
    SELECT * INTO v_worksheet
    FROM public.valuation_worksheets worksheet
    WHERE worksheet.id = NEW.worksheet_id
      AND worksheet.property_unit_id = NEW.property_unit_id
      AND worksheet.status = 'approved';
    IF NOT FOUND OR v_worksheet.inspection_date IS NULL
       OR v_worksheet.inspected_by IS NULL
       OR NULLIF(trim(v_worksheet.inspection_evidence), '') IS NULL
       OR v_worksheet.computed_market_value <> NEW.market_value THEN
      RAISE EXCEPTION 'Approval requires an approved, inspected valuation worksheet matching the assessment market value.';
    END IF;
    IF v_schedule_id IS NULL THEN
      v_schedule_id := v_worksheet.schedule_id;
    ELSIF v_worksheet.schedule_id IS DISTINCT FROM v_schedule_id THEN
      RAISE EXCEPTION 'The assessment and valuation worksheet must use the same schedule.';
    END IF;
  END IF;

  IF v_schedule_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.valuation_schedules schedule
    WHERE schedule.id = v_schedule_id
      AND schedule.status IN ('certified', 'in_force')
      AND schedule.effectivity_date IS NOT NULL
      AND schedule.effectivity_date <= NEW.effective_date
      AND NULLIF(trim(schedule.certification_reference), '') IS NOT NULL
      AND schedule.certification_reference NOT ILIKE '%pending%'
  ) THEN
    RAISE EXCEPTION 'Approval requires a certified valuation schedule effective on the assessment date.';
  END IF;

  IF NEW.assessed_value <> round(NEW.market_value::numeric * NEW.assessment_level_percent / 100)::bigint THEN
    RAISE EXCEPTION 'Assessed value must equal market value multiplied by the applicable assessment level.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM (
      SELECT level.level_percent, level.min_value, level.max_value
      FROM public.assessment_levels level
      WHERE level.classification = NEW.classification
        AND level.property_type = v_unit_type
        AND level.status = 'active'
        AND level.effective_date <= NEW.effective_date
        AND NULLIF(trim(level.legal_source), '') IS NOT NULL
        AND level.legal_source NOT ILIKE '%pending%'
      ORDER BY level.effective_date DESC, level.created_at DESC
      LIMIT 1
    ) current_level
    WHERE current_level.level_percent = NEW.assessment_level_percent
      AND COALESCE(current_level.min_value, 0) <= NEW.market_value
      AND (current_level.max_value IS NULL OR current_level.max_value >= NEW.market_value)
  ) THEN
    RAISE EXCEPTION 'Approval requires an active, effective assessment level supported by a non-pending legal source.';
  END IF;

  NEW.schedule_id := v_schedule_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_approved_assessment ON public.assessments;
CREATE TRIGGER validate_approved_assessment
BEFORE INSERT OR UPDATE ON public.assessments
FOR EACH ROW EXECUTE FUNCTION public.validate_approved_assessment();

CREATE OR REPLACE FUNCTION public.generate_rpt_charges(p_tax_year integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  a record;
  v_basic_count integer;
  v_sef_count integer;
  v_basic_rate numeric;
  v_sef_rate numeric;
  v_basic_jurisdiction uuid;
  v_sef_jurisdiction uuid;
  v_annual_basic bigint;
  v_annual_sef bigint;
  v_quarterly_basic bigint;
  v_quarterly_sef bigint;
  v_due_date date;
  v_inserted integer;
  v_generated integer := 0;
  v_skipped integer := 0;
  q integer;
  levy_row record;
BEGIN
  IF NOT public.has_staff_permission('billing') THEN
    RAISE EXCEPTION 'You do not have permission to generate billing.' USING ERRCODE = '42501';
  END IF;
  IF p_tax_year < 2000 OR p_tax_year > EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Manila')::date)::integer + 1 THEN
    RAISE EXCEPTION 'Enter a valid tax year.';
  END IF;
  IF (SELECT count(DISTINCT quarter) FROM public.due_dates WHERE tax_year = p_tax_year AND quarter BETWEEN 1 AND 4) <> 4 THEN
    RAISE EXCEPTION 'Four distinct due dates must be configured for tax year %.', p_tax_year;
  END IF;

  FOR a IN
    SELECT DISTINCT ON (assessment.property_unit_id)
      assessment.id AS assessment_id,
      assessment.property_id,
      assessment.property_unit_id,
      assessment.market_value,
      assessment.assessment_level_percent,
      assessment.assessed_value,
      assessment.classification,
      assessment.effective_date,
      assessment.schedule_id,
      unit.unit_type,
      property.municipality_id,
      property.province_id
    FROM public.assessments assessment
    JOIN public.property_units unit ON unit.id = assessment.property_unit_id
    JOIN public.properties property ON property.id = assessment.property_id
    WHERE assessment.status = 'approved'
      AND assessment.effective_date <= make_date(p_tax_year, 12, 31)
      AND unit.status = 'active'
      AND unit.is_exempt = false
      AND property.status = 'active'
    ORDER BY assessment.property_unit_id, assessment.effective_date DESC,
      assessment.approved_at DESC NULLS LAST, assessment.created_at DESC
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM (
        SELECT level.level_percent, level.min_value, level.max_value
        FROM public.assessment_levels level
        WHERE level.classification = a.classification
          AND level.property_type = a.unit_type
          AND level.status = 'active'
          AND level.effective_date <= a.effective_date
          AND NULLIF(trim(level.legal_source), '') IS NOT NULL
          AND level.legal_source NOT ILIKE '%pending%'
        ORDER BY level.effective_date DESC, level.created_at DESC
        LIMIT 1
      ) current_level
      WHERE current_level.level_percent = a.assessment_level_percent
        AND COALESCE(current_level.min_value, 0) <= a.market_value
        AND (current_level.max_value IS NULL OR current_level.max_value >= a.market_value)
    ) THEN
      RAISE EXCEPTION 'Approved assessment % has no active authorized assessment level for its effective date.', a.assessment_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.valuation_schedules schedule
      WHERE schedule.id = a.schedule_id
        AND schedule.status IN ('certified', 'in_force')
        AND schedule.effectivity_date <= a.effective_date
        AND NULLIF(trim(schedule.certification_reference), '') IS NOT NULL
        AND schedule.certification_reference NOT ILIKE '%pending%'
    ) THEN
      RAISE EXCEPTION 'Approved assessment % has no currently valid certified valuation schedule.', a.assessment_id;
    END IF;

    SELECT count(*), max(rate.rate_percent), max(rate.jurisdiction_id)
    INTO v_basic_count, v_basic_rate, v_basic_jurisdiction
    FROM public.tax_rates rate
    JOIN public.jurisdictions jurisdiction ON jurisdiction.id = rate.jurisdiction_id
    WHERE rate.levy_type = 'basic'
      AND rate.status = 'active'
      AND rate.effective_date <= make_date(p_tax_year, 1, 1)
      AND (rate.end_date IS NULL OR rate.end_date >= make_date(p_tax_year, 12, 31))
      AND NULLIF(trim(rate.ordinance_reference), '') IS NOT NULL
      AND rate.ordinance_reference NOT ILIKE '%pending%'
      AND NULLIF(trim(rate.legal_source), '') IS NOT NULL
      AND rate.legal_source NOT ILIKE '%pending%'
      AND rate.jurisdiction_id IN (a.municipality_id, a.province_id)
      AND (jurisdiction.type IN ('province', 'city') OR
           (jurisdiction.type = 'municipality' AND jurisdiction.is_metro_manila));
    IF v_basic_count <> 1 THEN
      RAISE EXCEPTION 'Exactly one authorized, effective basic RPT rate is required for property unit % and tax year %; found %.', a.property_unit_id, p_tax_year, v_basic_count;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.jurisdictions jurisdiction
      WHERE jurisdiction.id = v_basic_jurisdiction AND (
        (jurisdiction.type = 'province' AND v_basic_rate > 1.00) OR
        (jurisdiction.type IN ('city','municipality') AND v_basic_rate > 2.00)
      )
    ) THEN
      RAISE EXCEPTION 'The configured basic RPT rate exceeds the statutory ceiling.';
    END IF;

    SELECT count(*), max(rate.rate_percent), max(rate.jurisdiction_id)
    INTO v_sef_count, v_sef_rate, v_sef_jurisdiction
    FROM public.tax_rates rate
    JOIN public.jurisdictions jurisdiction ON jurisdiction.id = rate.jurisdiction_id
    WHERE rate.levy_type = 'sef'
      AND rate.status = 'active'
      AND rate.effective_date <= make_date(p_tax_year, 1, 1)
      AND (rate.end_date IS NULL OR rate.end_date >= make_date(p_tax_year, 12, 31))
      AND NULLIF(trim(rate.ordinance_reference), '') IS NOT NULL
      AND rate.ordinance_reference NOT ILIKE '%pending%'
      AND NULLIF(trim(rate.legal_source), '') IS NOT NULL
      AND rate.legal_source NOT ILIKE '%pending%'
      AND rate.jurisdiction_id IN (a.municipality_id, a.province_id)
      AND (jurisdiction.type IN ('province', 'city') OR
           (jurisdiction.type = 'municipality' AND jurisdiction.is_metro_manila));
    IF v_sef_count <> 1 THEN
      RAISE EXCEPTION 'Exactly one authorized, effective SEF rate is required for property unit % and tax year %; found %.', a.property_unit_id, p_tax_year, v_sef_count;
    END IF;
    IF v_sef_rate > 1.00 THEN
      RAISE EXCEPTION 'The configured SEF rate exceeds the statutory ceiling.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.tax_charges charge
      WHERE charge.property_unit_id = a.property_unit_id AND charge.tax_year = p_tax_year) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_annual_basic := round(a.assessed_value::numeric * v_basic_rate / 100)::bigint;
    v_annual_sef := round(a.assessed_value::numeric * v_sef_rate / 100)::bigint;

    FOR q IN 1..4 LOOP
      SELECT due_date INTO v_due_date FROM public.due_dates
      WHERE tax_year = p_tax_year AND quarter = q;
      v_quarterly_basic := (v_annual_basic / 4) + CASE WHEN q <= (v_annual_basic % 4) THEN 1 ELSE 0 END;
      v_quarterly_sef := (v_annual_sef / 4) + CASE WHEN q <= (v_annual_sef % 4) THEN 1 ELSE 0 END;

      FOR levy_row IN SELECT * FROM (VALUES
        ('basic'::text, v_quarterly_basic, v_basic_rate, v_basic_jurisdiction),
        ('sef'::text, v_quarterly_sef, v_sef_rate, v_sef_jurisdiction)
      ) AS amounts(levy_type, gross_amount, rate_percent, jurisdiction_id)
      LOOP
        IF levy_row.gross_amount <= 0 THEN CONTINUE; END IF;
        INSERT INTO public.tax_charges (
          property_id, property_unit_id, assessment_id, tax_year, quarter, levy_type,
          gross_amount, discount_amount, interest_amount, net_amount, paid_amount,
          balance, due_date, status, charge_basis
        ) VALUES (
          a.property_id, a.property_unit_id, a.assessment_id, p_tax_year, q, levy_row.levy_type,
          levy_row.gross_amount, 0, 0, levy_row.gross_amount, 0,
          levy_row.gross_amount, v_due_date, 'unpaid',
          jsonb_build_object(
            'market_value_centavos', a.market_value,
            'assessment_level_percent', a.assessment_level_percent,
            'assessed_value_centavos', a.assessed_value,
            'levy_rate_percent', levy_row.rate_percent,
            'basic_rate', v_basic_rate,
            'sef_rate', v_sef_rate,
            'annual_basic', v_annual_basic,
            'annual_sef', v_annual_sef,
            'quarterly_basic', v_quarterly_basic,
            'quarterly_sef', v_quarterly_sef,
            'rate_jurisdiction_id', levy_row.jurisdiction_id,
            'tax_year', p_tax_year,
            'quarter', q,
            'valuation_schedule_id', a.schedule_id
          )
        ) ON CONFLICT (property_unit_id, tax_year, quarter, levy_type) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        v_generated := v_generated + v_inserted;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'generated', v_generated,
    'skipped', v_skipped,
    'message', format('Generated %s tax charges; skipped %s property units that already had charges.', v_generated, v_skipped)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_rpt_charges(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_rpt_charges(integer) TO authenticated;

CREATE SEQUENCE IF NOT EXISTS public.rpt_receipt_sequence;
CREATE SEQUENCE IF NOT EXISTS public.rpt_cash_session_sequence;

DROP POLICY IF EXISTS staff_insert_cash_sessions ON public.cash_sessions;
DROP POLICY IF EXISTS staff_update_cash_sessions ON public.cash_sessions;

CREATE OR REPLACE FUNCTION public.open_rpt_cash_session()
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff_id uuid;
  v_session public.cash_sessions%ROWTYPE;
BEGIN
  IF NOT public.has_staff_permission('collection') THEN
    RAISE EXCEPTION 'You do not have permission to open a cash session.' USING ERRCODE = '42501';
  END IF;
  SELECT staff.id INTO v_staff_id FROM public.staff_users staff
  WHERE staff.auth_id = auth.uid() AND staff.is_active = true;
  IF v_staff_id IS NULL THEN RAISE EXCEPTION 'An active staff profile is required.'; END IF;

  -- Serialize session opening per cashier so two concurrent requests cannot create two sessions.
  PERFORM 1 FROM public.staff_users WHERE id = v_staff_id FOR UPDATE;
  SELECT * INTO v_session FROM public.cash_sessions session
  WHERE session.cashier_id = v_staff_id AND session.status = 'open'
  ORDER BY session.opened_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN RETURN v_session; END IF;

  INSERT INTO public.cash_sessions (
    session_number, cashier_id, opened_at, opening_balance, closing_balance,
    total_collected, total_receipts, status
  ) VALUES (
    'CS-' || to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYYMMDD') || '-' ||
      lpad(nextval('public.rpt_cash_session_sequence')::text, 8, '0'),
    v_staff_id, now(), 0, NULL, 0, 0, 'open'
  ) RETURNING * INTO v_session;
  RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_rpt_cash_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff_id uuid;
  v_closed_count integer;
BEGIN
  IF NOT public.has_staff_permission('collection') THEN
    RAISE EXCEPTION 'You do not have permission to close a cash session.' USING ERRCODE = '42501';
  END IF;
  SELECT staff.id INTO v_staff_id FROM public.staff_users staff
  WHERE staff.auth_id = auth.uid() AND staff.is_active = true;
  IF v_staff_id IS NULL THEN RAISE EXCEPTION 'An active staff profile is required.'; END IF;

  UPDATE public.cash_sessions SET
    closed_at = now(),
    closing_balance = total_collected,
    status = 'closed'
  WHERE id = p_session_id AND cashier_id = v_staff_id AND status = 'open';
  GET DIAGNOSTICS v_closed_count = ROW_COUNT;
  IF v_closed_count <> 1 THEN
    RAISE EXCEPTION 'The open cash session was not found for this staff account.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.open_rpt_cash_session() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_rpt_cash_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_rpt_cash_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_rpt_cash_session(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.post_rpt_payment(
  p_charge_ids uuid[],
  p_payer_name text,
  p_payer_type text,
  p_payment_method text,
  p_tender_amount bigint,
  p_cash_session_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff_id uuid;
  v_payment_id uuid;
  v_receipt_id uuid;
  v_receipt_number text;
  v_total_due bigint := 0;
  v_change bigint;
  v_allocated bigint;
  v_principal bigint;
  v_interest bigint;
  v_months integer;
  v_share_config jsonb;
  v_share_sum numeric;
  v_province bigint;
  v_municipality bigint;
  v_barangay bigint;
  v_sef_province bigint;
  v_sef_municipality bigint;
  v_property_count integer;
  v_property_id uuid;
  v_as_of_date date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_discount_percent numeric := 0;
  v_discount_total bigint := 0;
  v_discount_amount bigint;
  v_discount_rule_count integer := 0;
  v_first_due date;
  v_selected_count integer;
  v_selected_units integer;
  v_selected_years integer;
  v_selected_tax_year integer;
  c record;
BEGIN
  IF NOT public.has_staff_permission('collection') THEN
    RAISE EXCEPTION 'You do not have permission to collect payments.' USING ERRCODE = '42501';
  END IF;
  SELECT staff.id INTO v_staff_id FROM public.staff_users staff
  WHERE staff.auth_id = auth.uid() AND staff.is_active = true;
  IF v_staff_id IS NULL THEN RAISE EXCEPTION 'An active staff profile is required.'; END IF;
  IF p_charge_ids IS NULL OR cardinality(p_charge_ids) = 0 THEN
    RAISE EXCEPTION 'Select one or more tax charges.';
  END IF;
  IF cardinality(p_charge_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_charge_ids) ids(id)) THEN
    RAISE EXCEPTION 'Selected tax charges must be distinct.';
  END IF;
  IF NULLIF(trim(p_payer_name), '') IS NULL OR p_tender_amount <= 0 THEN
    RAISE EXCEPTION 'Payer name and a positive tender amount are required.';
  END IF;
  IF p_payer_type NOT IN ('taxpayer','representative','agent') OR
     p_payment_method NOT IN ('cash','check','bank_transfer','online') THEN
    RAISE EXCEPTION 'Invalid payer type or payment method.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cash_sessions session
    WHERE session.id = p_cash_session_id AND session.cashier_id = v_staff_id AND session.status = 'open'
  ) THEN
    RAISE EXCEPTION 'Open a cash session for this staff account before posting a payment.';
  END IF;

  -- Lock selected charges and calculate the authoritative amount due in the database.
  PERFORM charge.id FROM public.tax_charges charge
  WHERE charge.id = ANY(p_charge_ids) FOR UPDATE;
  IF (SELECT count(*) FROM public.tax_charges WHERE id = ANY(p_charge_ids)
      AND status IN ('unpaid','partially_paid') AND balance > 0) <> cardinality(p_charge_ids) THEN
    RAISE EXCEPTION 'One or more selected charges are no longer unpaid. Refresh and try again.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tax_charges older
    JOIN public.tax_charges selected ON selected.id = ANY(p_charge_ids)
      AND selected.property_id = older.property_id
      AND older.tax_year < selected.tax_year
    WHERE older.balance > 0 AND older.status IN ('unpaid','partially_paid')
      AND NOT (older.id = ANY(p_charge_ids))
  ) THEN
    RAISE EXCEPTION 'Select and settle all prior-year delinquencies for the property before paying a current-year charge.';
  END IF;

  SELECT count(DISTINCT property_id), min(property_id) INTO v_property_count, v_property_id
  FROM public.tax_charges WHERE id = ANY(p_charge_ids);

  -- Automatic discount is limited to one complete annual basic+SEF bill for one unit,
  -- paid before Q1 is due, under an explicitly configured ordinance rule.
  SELECT count(*), count(DISTINCT property_unit_id), count(DISTINCT tax_year), min(tax_year)
  INTO v_selected_count, v_selected_units, v_selected_years, v_selected_tax_year
  FROM public.tax_charges WHERE id = ANY(p_charge_ids);
  IF v_selected_count = 8 AND v_selected_units = 1 AND v_selected_years = 1
     AND (SELECT count(DISTINCT quarter) FROM public.tax_charges WHERE id = ANY(p_charge_ids)) = 4
     AND (SELECT count(DISTINCT levy_type) FROM public.tax_charges WHERE id = ANY(p_charge_ids)) = 2
     AND NOT EXISTS (
       SELECT 1 FROM public.tax_charges selected
       WHERE selected.id = ANY(p_charge_ids)
         AND (selected.levy_type NOT IN ('basic','sef') OR selected.paid_amount <> 0
           OR selected.discount_amount <> 0 OR selected.balance <> selected.net_amount)
     ) THEN
    SELECT due_date INTO v_first_due FROM public.due_dates
    WHERE tax_year = v_selected_tax_year AND quarter = 1;
    IF v_first_due IS NOT NULL AND v_as_of_date < v_first_due THEN
      SELECT count(*), max(rule.max_percent)
      INTO v_discount_rule_count, v_discount_percent
      FROM public.discount_rules rule
      WHERE rule.status = 'active'
        AND lower(trim(COALESCE(rule.eligibility_criteria,''))) = 'advance_full_year'
        AND rule.valid_from <= v_as_of_date
        AND (rule.valid_until IS NULL OR rule.valid_until >= v_as_of_date)
        AND NULLIF(trim(rule.ordinance_reference), '') IS NOT NULL
        AND rule.ordinance_reference NOT ILIKE '%pending%'
        AND rule.max_percent BETWEEN 0 AND 20;
      IF v_discount_rule_count > 1 THEN
        RAISE EXCEPTION 'Multiple active annual advance-discount rules match this payment. Resolve the configuration before collection.';
      ELSIF v_discount_rule_count = 0 THEN
        v_discount_percent := 0;
      END IF;
    END IF;
  END IF;

  FOR c IN
    SELECT charge.* FROM public.tax_charges charge
    WHERE charge.id = ANY(p_charge_ids)
    ORDER BY charge.tax_year, charge.due_date, charge.quarter, charge.levy_type
  LOOP
    v_months := ((EXTRACT(YEAR FROM v_as_of_date)::integer - EXTRACT(YEAR FROM c.due_date)::integer) * 12)
      + (EXTRACT(MONTH FROM v_as_of_date)::integer - EXTRACT(MONTH FROM c.due_date)::integer);
    IF v_as_of_date > c.due_date AND EXTRACT(DAY FROM v_as_of_date) > EXTRACT(DAY FROM c.due_date) THEN
      v_months := v_months + 1;
    END IF;
    v_months := LEAST(GREATEST(v_months, 0), 36);
    v_interest := CASE WHEN v_as_of_date > c.due_date
      THEN round(c.balance::numeric * 0.02 * v_months)::bigint ELSE 0 END;
    v_discount_amount := CASE WHEN v_discount_percent > 0
      THEN round(c.balance::numeric * v_discount_percent / 100)::bigint ELSE 0 END;
    v_discount_total := v_discount_total + v_discount_amount;
    v_total_due := v_total_due + c.balance + v_interest - v_discount_amount;
  END LOOP;
  IF p_tender_amount < v_total_due THEN
    RAISE EXCEPTION 'Tender is below the current amount due of PHP %.', to_char(v_total_due::numeric / 100, 'FM999,999,999,990.00');
  END IF;

  INSERT INTO public.payments (
    property_id, payer_name, payer_type, payment_method, tender_amount,
    total_allocated, change_amount, payment_date, status, cash_session_id,
    collected_by, notes
  ) VALUES (
    CASE WHEN v_property_count = 1 THEN v_property_id ELSE NULL END,
    trim(p_payer_name), p_payer_type, p_payment_method, p_tender_amount,
    v_total_due, p_tender_amount - v_total_due, now(), 'initiated', p_cash_session_id,
    v_staff_id, NULLIF(trim(p_notes), '')
  ) RETURNING id INTO v_payment_id;

  FOR c IN
    SELECT charge.* FROM public.tax_charges charge
    WHERE charge.id = ANY(p_charge_ids)
    ORDER BY charge.tax_year, charge.due_date, charge.quarter, charge.levy_type
  LOOP
    v_months := ((EXTRACT(YEAR FROM v_as_of_date)::integer - EXTRACT(YEAR FROM c.due_date)::integer) * 12)
      + (EXTRACT(MONTH FROM v_as_of_date)::integer - EXTRACT(MONTH FROM c.due_date)::integer);
    IF v_as_of_date > c.due_date AND EXTRACT(DAY FROM v_as_of_date) > EXTRACT(DAY FROM c.due_date) THEN
      v_months := v_months + 1;
    END IF;
    v_months := LEAST(GREATEST(v_months, 0), 36);
    v_interest := CASE WHEN v_as_of_date > c.due_date
      THEN round(c.balance::numeric * 0.02 * v_months)::bigint ELSE 0 END;
    v_discount_amount := CASE WHEN v_discount_percent > 0
      THEN round(c.balance::numeric * v_discount_percent / 100)::bigint ELSE 0 END;
    v_principal := c.balance - v_discount_amount;
    v_allocated := v_principal + v_interest;

    SELECT levy.sharing_config INTO v_share_config
    FROM public.levy_types levy WHERE levy.code = c.levy_type AND levy.is_active = true;
    IF v_share_config IS NULL THEN
      RAISE EXCEPTION 'Revenue-share configuration is missing for levy type %.', c.levy_type;
    END IF;
    v_share_sum := COALESCE((v_share_config->>'province')::numeric, 0)
      + COALESCE((v_share_config->>'municipality')::numeric, 0)
      + COALESCE((v_share_config->>'barangay')::numeric, 0)
      + COALESCE((v_share_config->>'sef_province')::numeric, 0)
      + COALESCE((v_share_config->>'sef_municipality')::numeric, 0);
    IF abs(v_share_sum - 1.0) > 0.001 THEN
      RAISE EXCEPTION 'Configure levy revenue shares totaling 100%% for % before collecting it.', c.levy_type;
    END IF;

    v_province := round(v_principal * COALESCE((v_share_config->>'province')::numeric,0))::bigint;
    v_municipality := round(v_principal * COALESCE((v_share_config->>'municipality')::numeric,0))::bigint;
    v_barangay := v_principal - v_province - v_municipality;
    v_sef_province := round(v_principal * COALESCE((v_share_config->>'sef_province')::numeric,0))::bigint;
    v_sef_municipality := v_principal - v_sef_province;
    IF COALESCE((v_share_config->>'sef_province')::numeric,0) = 0 THEN v_sef_municipality := 0; END IF;
    IF COALESCE((v_share_config->>'province')::numeric,0)
       + COALESCE((v_share_config->>'municipality')::numeric,0)
       + COALESCE((v_share_config->>'barangay')::numeric,0) = 0 THEN
      v_barangay := 0;
    END IF;

    INSERT INTO public.payment_allocations (
      payment_id, tax_charge_id, allocated_amount, principal_amount, interest_amount, discount_amount,
      share_province, share_municipality, share_barangay, share_sef_province, share_sef_municipality
    ) VALUES (
      v_payment_id, c.id, v_allocated, v_principal, v_interest, v_discount_amount,
      v_province, v_municipality, v_barangay, v_sef_province, v_sef_municipality
    );

    UPDATE public.tax_charges SET
      discount_amount = discount_amount + v_discount_amount,
      net_amount = gross_amount - discount_amount - v_discount_amount,
      paid_amount = paid_amount + v_principal,
      balance = 0,
      status = 'paid'
    WHERE id = c.id;
  END LOOP;

  v_receipt_number := 'RPT-' || to_char(v_as_of_date, 'YYYYMMDD') || '-' ||
    lpad(nextval('public.rpt_receipt_sequence')::text, 8, '0');
  INSERT INTO public.receipts (
    receipt_number, payment_id, property_id, amount, issued_date, issued_by, status
  ) VALUES (
    v_receipt_number, v_payment_id,
    CASE WHEN v_property_count = 1 THEN v_property_id ELSE NULL END,
    v_total_due, now(), v_staff_id, 'issued'
  ) RETURNING id INTO v_receipt_id;

  UPDATE public.payments SET receipt_id = v_receipt_id, status = 'receipted'
  WHERE id = v_payment_id;

  UPDATE public.cash_sessions SET
    total_collected = total_collected + v_total_due,
    total_receipts = total_receipts + 1
  WHERE id = p_cash_session_id AND cashier_id = v_staff_id AND status = 'open';

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'total_allocated', v_total_due,
    'discount_amount', v_discount_total,
    'change_amount', p_tender_amount - v_total_due
  );
END;
$$;

REVOKE ALL ON FUNCTION public.post_rpt_payment(uuid[], text, text, text, bigint, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_rpt_payment(uuid[], text, text, text, bigint, uuid, text) TO authenticated;
