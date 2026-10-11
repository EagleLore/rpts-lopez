import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, Badge, Button, Modal, Input, Select, TextArea, EmptyState, PageHeader } from '@/components/ui';
import { formatCurrency, formatDate, formatPercent, capitalize } from '@/lib/utils';
import { PROPERTY_CLASSIFICATIONS, UNIT_TYPES, LEVY_TYPES } from '@/lib/constants';
import { Settings, Percent, Calendar, FileText, AlertTriangle, Save, Plus, Edit } from 'lucide-react';
import type {
  TaxRate,
  AssessmentLevel,
  ValuationSchedule,
  DiscountRule,
  DueDate,
  LevyType,
  ComplianceCalendarEntry,
} from '@/lib/types';

// ─── Tab configuration ────────────────────────────────────────────────────────

type TabKey =
  | 'tax_rates'
  | 'assessment_levels'
  | 'valuation_schedules'
  | 'discount_rules'
  | 'due_dates'
  | 'levy_types'
  | 'compliance_calendar';

interface TabDef {
  key: TabKey;
  label: string;
  icon: typeof Settings;
}

const TABS: TabDef[] = [
  { key: 'tax_rates', label: 'Tax Rates', icon: Percent },
  { key: 'assessment_levels', label: 'Assessment Levels', icon: FileText },
  { key: 'valuation_schedules', label: 'Valuation Schedules', icon: FileText },
  { key: 'discount_rules', label: 'Discount Rules', icon: Percent },
  { key: 'due_dates', label: 'Due Dates', icon: Calendar },
  { key: 'levy_types', label: 'Levy Types', icon: Settings },
  { key: 'compliance_calendar', label: 'Compliance Calendar', icon: Calendar },
];

// ─── Label helpers ─────────────────────────────────────────────────────────────

function levyLabel(code: string): string {
  return LEVY_TYPES.find((l) => l.code === code)?.name || capitalize(code);
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

const QUARTER_OPTIONS = [
  { value: '1', label: '1st Quarter' },
  { value: '2', label: '2nd Quarter' },
  { value: '3', label: '3rd Quarter' },
  { value: '4', label: '4th Quarter' },
];

const LEVY_TYPE_OPTIONS = LEVY_TYPES.map((l) => ({ value: l.code, label: l.name }));

const CLASSIFICATION_OPTIONS = PROPERTY_CLASSIFICATIONS.map((c) => ({
  value: c,
  label: capitalize(c),
}));

const PROPERTY_TYPE_OPTIONS = UNIT_TYPES.map((u) => ({ value: u, label: capitalize(u) }));

const VALUATION_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'certified', label: 'Certified' },
  { value: 'in_force', label: 'In Force' },
  { value: 'superseded', label: 'Superseded' },
];

const COMPLIANCE_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'prepared', label: 'Prepared' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'overdue', label: 'Overdue' },
];

// ─── Form state types ──────────────────────────────────────────────────────────

interface TaxRateForm {
  levy_type: string;
  rate_percent: string;
  effective_date: string;
  ordinance_reference: string;
  legal_source: string;
}

interface AssessmentLevelForm {
  classification: string;
  property_type: string;
  level_percent: string;
  effective_date: string;
  legal_source: string;
}

interface ValuationScheduleForm {
  name: string;
  version: string;
  status: string;
  publication_date: string;
  effectivity_date: string;
  certification_reference: string;
  legal_source: string;
  notes: string;
}

interface DiscountRuleForm {
  name: string;
  max_percent: string;
  valid_from: string;
  valid_until: string;
  ordinance_reference: string;
  eligibility_criteria: string;
}

interface DueDateForm {
  tax_year: string;
  quarter: string;
  due_date: string;
}

interface ComplianceCalendarForm {
  report_name: string;
  reporting_authority: string;
  period: string;
  deadline: string;
  status: string;
  notes: string;
}

const EMPTY_TAX_RATE_FORM: TaxRateForm = {
  levy_type: '',
  rate_percent: '',
  effective_date: todayISO(),
  ordinance_reference: '',
  legal_source: '',
};

const EMPTY_ASSESSMENT_LEVEL_FORM: AssessmentLevelForm = {
  classification: '',
  property_type: '',
  level_percent: '',
  effective_date: todayISO(),
  legal_source: '',
};

const EMPTY_VALUATION_SCHEDULE_FORM: ValuationScheduleForm = {
  name: '',
  version: '',
  status: 'draft',
  publication_date: '',
  effectivity_date: '',
  certification_reference: '',
  legal_source: '',
  notes: '',
};

const EMPTY_DISCOUNT_RULE_FORM: DiscountRuleForm = {
  name: '',
  max_percent: '',
  valid_from: todayISO(),
  valid_until: '',
  ordinance_reference: '',
  eligibility_criteria: '',
};

const EMPTY_DUE_DATE_FORM: DueDateForm = {
  tax_year: String(new Date().getFullYear()),
  quarter: '',
  due_date: todayISO(),
};

const EMPTY_COMPLIANCE_FORM: ComplianceCalendarForm = {
  report_name: '',
  reporting_authority: '',
  period: '',
  deadline: todayISO(),
  status: 'pending',
  notes: '',
};

// ─── Component ─────────────────────────────────────────────────────────────────

export function ConfigurationPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('tax_rates');

  // Data state per tab
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [assessmentLevels, setAssessmentLevels] = useState<AssessmentLevel[]>([]);
  const [valuationSchedules, setValuationSchedules] = useState<ValuationSchedule[]>([]);
  const [discountRules, setDiscountRules] = useState<DiscountRule[]>([]);
  const [dueDates, setDueDates] = useState<DueDate[]>([]);
  const [levyTypes, setLevyTypes] = useState<LevyType[]>([]);
  const [complianceEntries, setComplianceEntries] = useState<ComplianceCalendarEntry[]>([]);

  // Per-tab loading + error
  const [tabLoading, setTabLoading] = useState<Record<TabKey, boolean>>({
    tax_rates: false,
    assessment_levels: false,
    valuation_schedules: false,
    discount_rules: false,
    due_dates: false,
    levy_types: false,
    compliance_calendar: false,
  });
  const [tabError, setTabError] = useState<Record<TabKey, string | null>>({
    tax_rates: null,
    assessment_levels: null,
    valuation_schedules: null,
    discount_rules: null,
    due_dates: null,
    levy_types: null,
    compliance_calendar: null,
  });
  const [loadedTabs, setLoadedTabs] = useState<Set<TabKey>>(new Set());

  // Modal + form state
  const [showTaxRateModal, setShowTaxRateModal] = useState(false);
  const [taxRateForm, setTaxRateForm] = useState<TaxRateForm>(EMPTY_TAX_RATE_FORM);

  const [showAssessmentLevelModal, setShowAssessmentLevelModal] = useState(false);
  const [assessmentLevelForm, setAssessmentLevelForm] = useState<AssessmentLevelForm>(EMPTY_ASSESSMENT_LEVEL_FORM);

  const [showValuationModal, setShowValuationModal] = useState(false);
  const [valuationForm, setValuationForm] = useState<ValuationScheduleForm>(EMPTY_VALUATION_SCHEDULE_FORM);

  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountForm, setDiscountForm] = useState<DiscountRuleForm>(EMPTY_DISCOUNT_RULE_FORM);

  const [showDueDateModal, setShowDueDateModal] = useState(false);
  const [dueDateForm, setDueDateForm] = useState<DueDateForm>(EMPTY_DUE_DATE_FORM);

  const [showComplianceModal, setShowComplianceModal] = useState(false);
  const [complianceForm, setComplianceForm] = useState<ComplianceCalendarForm>(EMPTY_COMPLIANCE_FORM);

  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // ─── Data loaders ───────────────────────────────────────────────────────────

  const loadTaxRates = useCallback(async () => {
    setTabLoading((p) => ({ ...p, tax_rates: true }));
    setTabError((p) => ({ ...p, tax_rates: null }));
    const { data, error: err } = await supabase
      .from('tax_rates')
      .select('*')
      .order('effective_date', { ascending: false });
    setTabLoading((p) => ({ ...p, tax_rates: false }));
    if (err) {
      setTabError((p) => ({ ...p, tax_rates: err.message }));
    } else {
      setTaxRates((data || []) as TaxRate[]);
    }
  }, []);

  const loadAssessmentLevels = useCallback(async () => {
    setTabLoading((p) => ({ ...p, assessment_levels: true }));
    setTabError((p) => ({ ...p, assessment_levels: null }));
    const { data, error: err } = await supabase
      .from('assessment_levels')
      .select('*')
      .order('classification', { ascending: true })
      .order('property_type', { ascending: true });
    setTabLoading((p) => ({ ...p, assessment_levels: false }));
    if (err) {
      setTabError((p) => ({ ...p, assessment_levels: err.message }));
    } else {
      setAssessmentLevels((data || []) as AssessmentLevel[]);
    }
  }, []);

  const loadValuationSchedules = useCallback(async () => {
    setTabLoading((p) => ({ ...p, valuation_schedules: true }));
    setTabError((p) => ({ ...p, valuation_schedules: null }));
    const { data, error: err } = await supabase
      .from('valuation_schedules')
      .select('*')
      .order('effectivity_date', { ascending: false, nullsFirst: false });
    setTabLoading((p) => ({ ...p, valuation_schedules: false }));
    if (err) {
      setTabError((p) => ({ ...p, valuation_schedules: err.message }));
    } else {
      setValuationSchedules((data || []) as ValuationSchedule[]);
    }
  }, []);

  const loadDiscountRules = useCallback(async () => {
    setTabLoading((p) => ({ ...p, discount_rules: true }));
    setTabError((p) => ({ ...p, discount_rules: null }));
    const { data, error: err } = await supabase
      .from('discount_rules')
      .select('*')
      .order('valid_from', { ascending: false });
    setTabLoading((p) => ({ ...p, discount_rules: false }));
    if (err) {
      setTabError((p) => ({ ...p, discount_rules: err.message }));
    } else {
      setDiscountRules((data || []) as DiscountRule[]);
    }
  }, []);

  const loadDueDates = useCallback(async () => {
    setTabLoading((p) => ({ ...p, due_dates: true }));
    setTabError((p) => ({ ...p, due_dates: null }));
    const { data, error: err } = await supabase
      .from('due_dates')
      .select('*')
      .order('tax_year', { ascending: false })
      .order('quarter', { ascending: true });
    setTabLoading((p) => ({ ...p, due_dates: false }));
    if (err) {
      setTabError((p) => ({ ...p, due_dates: err.message }));
    } else {
      setDueDates((data || []) as DueDate[]);
    }
  }, []);

  const loadLevyTypes = useCallback(async () => {
    setTabLoading((p) => ({ ...p, levy_types: true }));
    setTabError((p) => ({ ...p, levy_types: null }));
    const { data, error: err } = await supabase
      .from('levy_types')
      .select('*')
      .order('code', { ascending: true });
    setTabLoading((p) => ({ ...p, levy_types: false }));
    if (err) {
      setTabError((p) => ({ ...p, levy_types: err.message }));
    } else {
      setLevyTypes((data || []) as LevyType[]);
    }
  }, []);

  const loadComplianceCalendar = useCallback(async () => {
    setTabLoading((p) => ({ ...p, compliance_calendar: true }));
    setTabError((p) => ({ ...p, compliance_calendar: null }));
    const { data, error: err } = await supabase
      .from('compliance_calendar')
      .select('*')
      .order('deadline', { ascending: true });
    setTabLoading((p) => ({ ...p, compliance_calendar: false }));
    if (err) {
      setTabError((p) => ({ ...p, compliance_calendar: err.message }));
    } else {
      setComplianceEntries((data || []) as ComplianceCalendarEntry[]);
    }
  }, []);

  // ─── Lazy-load the active tab's data ────────────────────────────────────────

  useEffect(() => {
    if (loadedTabs.has(activeTab)) return;
    switch (activeTab) {
      case 'tax_rates':
        loadTaxRates();
        break;
      case 'assessment_levels':
        loadAssessmentLevels();
        break;
      case 'valuation_schedules':
        loadValuationSchedules();
        break;
      case 'discount_rules':
        loadDiscountRules();
        break;
      case 'due_dates':
        loadDueDates();
        break;
      case 'levy_types':
        loadLevyTypes();
        break;
      case 'compliance_calendar':
        loadComplianceCalendar();
        break;
    }
    setLoadedTabs((prev) => new Set(prev).add(activeTab));
  }, [activeTab, loadedTabs, loadTaxRates, loadAssessmentLevels, loadValuationSchedules, loadDiscountRules, loadDueDates, loadLevyTypes, loadComplianceCalendar]);

  // ─── Create handlers ────────────────────────────────────────────────────────

  async function handleCreateTaxRate() {
    setModalError(null);
    if (!taxRateForm.levy_type) { setModalError('Please select a levy type.'); return; }
    const rate = parseFloat(taxRateForm.rate_percent);
    if (isNaN(rate) || rate <= 0) { setModalError('Please enter a valid rate percentage.'); return; }
    if (!taxRateForm.effective_date) { setModalError('Please enter an effective date.'); return; }

    setSaving(true);
    const { error: insErr } = await supabase.from('tax_rates').insert({
      levy_type: taxRateForm.levy_type,
      rate_percent: rate,
      effective_date: taxRateForm.effective_date,
      ordinance_reference: taxRateForm.ordinance_reference.trim() || null,
      legal_source: taxRateForm.legal_source.trim() || null,
      status: 'active',
    });
    setSaving(false);
    if (insErr) { setModalError(insErr.message); return; }
    setShowTaxRateModal(false);
    setTaxRateForm(EMPTY_TAX_RATE_FORM);
    await loadTaxRates();
  }

  async function handleCreateAssessmentLevel() {
    setModalError(null);
    if (!assessmentLevelForm.classification) { setModalError('Please select a classification.'); return; }
    if (!assessmentLevelForm.property_type) { setModalError('Please select a property type.'); return; }
    const level = parseFloat(assessmentLevelForm.level_percent);
    if (isNaN(level) || level <= 0) { setModalError('Please enter a valid assessment level percentage.'); return; }
    if (!assessmentLevelForm.effective_date) { setModalError('Please enter an effective date.'); return; }

    setSaving(true);
    const { error: insErr } = await supabase.from('assessment_levels').insert({
      classification: assessmentLevelForm.classification,
      property_type: assessmentLevelForm.property_type,
      level_percent: level,
      effective_date: assessmentLevelForm.effective_date,
      legal_source: assessmentLevelForm.legal_source.trim() || null,
      status: 'active',
    });
    setSaving(false);
    if (insErr) { setModalError(insErr.message); return; }
    setShowAssessmentLevelModal(false);
    setAssessmentLevelForm(EMPTY_ASSESSMENT_LEVEL_FORM);
    await loadAssessmentLevels();
  }

  async function handleCreateValuationSchedule() {
    setModalError(null);
    if (!valuationForm.name.trim()) { setModalError('Please enter a schedule name.'); return; }
    if (!valuationForm.version.trim()) { setModalError('Please enter a version.'); return; }

    setSaving(true);
    const { error: insErr } = await supabase.from('valuation_schedules').insert({
      name: valuationForm.name.trim(),
      version: valuationForm.version.trim(),
      status: valuationForm.status,
      publication_date: valuationForm.publication_date || null,
      effectivity_date: valuationForm.effectivity_date || null,
      certification_reference: valuationForm.certification_reference.trim() || null,
      legal_source: valuationForm.legal_source.trim() || null,
      notes: valuationForm.notes.trim() || null,
    });
    setSaving(false);
    if (insErr) { setModalError(insErr.message); return; }
    setShowValuationModal(false);
    setValuationForm(EMPTY_VALUATION_SCHEDULE_FORM);
    await loadValuationSchedules();
  }

  async function handleCreateDiscountRule() {
    setModalError(null);
    if (!discountForm.name.trim()) { setModalError('Please enter a rule name.'); return; }
    const maxPct = parseFloat(discountForm.max_percent);
    if (isNaN(maxPct) || maxPct <= 0) { setModalError('Please enter a valid maximum discount percentage.'); return; }
    if (!discountForm.valid_from) { setModalError('Please enter a valid-from date.'); return; }

    setSaving(true);
    const { error: insErr } = await supabase.from('discount_rules').insert({
      name: discountForm.name.trim(),
      max_percent: maxPct,
      eligibility_criteria: discountForm.eligibility_criteria.trim() || null,
      valid_from: discountForm.valid_from,
      valid_until: discountForm.valid_until || null,
      ordinance_reference: discountForm.ordinance_reference.trim() || null,
      status: 'active',
    });
    setSaving(false);
    if (insErr) { setModalError(insErr.message); return; }
    setShowDiscountModal(false);
    setDiscountForm(EMPTY_DISCOUNT_RULE_FORM);
    await loadDiscountRules();
  }

  async function handleCreateDueDate() {
    setModalError(null);
    const year = parseInt(dueDateForm.tax_year, 10);
    if (isNaN(year) || year < 1900) { setModalError('Please enter a valid tax year.'); return; }
    if (!dueDateForm.quarter) { setModalError('Please select a quarter.'); return; }
    if (!dueDateForm.due_date) { setModalError('Please enter a due date.'); return; }

    setSaving(true);
    const { error: insErr } = await supabase.from('due_dates').insert({
      tax_year: year,
      quarter: parseInt(dueDateForm.quarter, 10),
      due_date: dueDateForm.due_date,
    });
    setSaving(false);
    if (insErr) { setModalError(insErr.message); return; }
    setShowDueDateModal(false);
    setDueDateForm(EMPTY_DUE_DATE_FORM);
    await loadDueDates();
  }

  async function handleCreateComplianceEntry() {
    setModalError(null);
    if (!complianceForm.report_name.trim()) { setModalError('Please enter a report name.'); return; }
    if (!complianceForm.reporting_authority.trim()) { setModalError('Please enter a reporting authority.'); return; }
    if (!complianceForm.period.trim()) { setModalError('Please enter a reporting period.'); return; }
    if (!complianceForm.deadline) { setModalError('Please enter a deadline.'); return; }

    setSaving(true);
    const { error: insErr } = await supabase.from('compliance_calendar').insert({
      report_name: complianceForm.report_name.trim(),
      reporting_authority: complianceForm.reporting_authority.trim(),
      period: complianceForm.period.trim(),
      deadline: complianceForm.deadline,
      status: complianceForm.status,
      notes: complianceForm.notes.trim() || null,
    });
    setSaving(false);
    if (insErr) { setModalError(insErr.message); return; }
    setShowComplianceModal(false);
    setComplianceForm(EMPTY_COMPLIANCE_FORM);
    await loadComplianceCalendar();
  }

  // ─── Shared table helpers ───────────────────────────────────────────────────

  function TableShell({
    title,
    count,
    onAdd,
    addLabel,
    headers,
    children,
    loading,
    isEmpty,
    emptyIcon,
    emptyTitle,
    emptyDescription,
  }: {
    title: string;
    count: number;
    onAdd?: () => void;
    addLabel?: string;
    headers: string[];
    children: React.ReactNode;
    loading: boolean;
    isEmpty: boolean;
    emptyIcon: React.ReactNode;
    emptyTitle: string;
    emptyDescription?: string;
  }) {
    return (
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">
            {title}
            <span className="ml-2 text-sm font-normal text-gray-400">{count}</span>
          </h2>
          {onAdd && (
            <Button size="sm" onClick={onAdd}>
              <Plus className="h-4 w-4" />
              {addLabel}
            </Button>
          )}
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-700" />
          </div>
        ) : isEmpty ? (
          <EmptyState
            icon={emptyIcon}
            title={emptyTitle}
            description={emptyDescription}
            action={onAdd ? <Button size="sm" onClick={onAdd}><Plus className="h-4 w-4" />{addLabel}</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  {headers.map((h, i) => (
                    <th
                      key={i}
                      className={`px-4 py-3 ${i === headers.length - 1 ? 'text-right' : ''}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">{children}</tbody>
            </table>
          </div>
        )}
      </Card>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="System Configuration"
        description="Manage tax rates, assessment levels, valuation schedules, and statutory configuration"
        action={
          <Button variant="outline" onClick={() => setLoadedTabs(new Set())}>
            <Settings className="h-4 w-4" />
            Refresh All
          </Button>
        }
      />

      {/* ─── Pending Certification Banner ──────────────────────────────────── */}
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-yellow-300 bg-yellow-50 px-5 py-4">
        <AlertTriangle className="mt-0.5 h-6 w-6 flex-shrink-0 text-yellow-600" />
        <div className="flex-1">
          <h3 className="text-sm font-bold text-yellow-900">
            Pending Certification — Illustrative Values
          </h3>
          <p className="mt-1 text-sm text-yellow-800">
            All tax rates, assessment levels, and valuation schedules displayed in this module are
            pre-loaded with illustrative values pending formal certification by the{' '}
            <strong>Quezon Province</strong>. These values must not be used for official assessments
            until certified and enacted through the appropriate Sanggunian ordinance. Contact the
            Provincial Assessor's Office for the certified schedule.
          </p>
        </div>
      </div>

      {/* ─── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                active
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/*  Tab: Tax Rates                                                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'tax_rates' && (
        <>
          {tabError.tax_rates && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {tabError.tax_rates}
            </div>
          )}
          <TableShell
            title="Tax Rates"
            count={taxRates.length}
            onAdd={() => { setTaxRateForm(EMPTY_TAX_RATE_FORM); setModalError(null); setShowTaxRateModal(true); }}
            addLabel="Add Tax Rate"
            headers={['Levy Type', 'Rate', 'Effective Date', 'Ordinance Ref.', 'Legal Source', 'Status']}
            loading={tabLoading.tax_rates}
            isEmpty={taxRates.length === 0}
            emptyIcon={<Percent className="h-8 w-8" />}
            emptyTitle="No tax rates configured"
            emptyDescription="Add a tax rate to define the levy percentage applied to assessed values."
          >
            {taxRates.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{levyLabel(r.levy_type)}</td>
                <td className="px-4 py-3 text-gray-700">{formatPercent(r.rate_percent)}</td>
                <td className="px-4 py-3 text-gray-700">{formatDate(r.effective_date)}</td>
                <td className="px-4 py-3 text-gray-700">{r.ordinance_reference || '—'}</td>
                <td className="px-4 py-3 text-gray-500">{r.legal_source || '—'}</td>
                <td className="px-4 py-3 text-right"><Badge status={r.status} /></td>
              </tr>
            ))}
          </TableShell>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/*  Tab: Assessment Levels                                              */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'assessment_levels' && (
        <>
          {tabError.assessment_levels && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {tabError.assessment_levels}
            </div>
          )}
          <TableShell
            title="Assessment Levels"
            count={assessmentLevels.length}
            onAdd={() => { setAssessmentLevelForm(EMPTY_ASSESSMENT_LEVEL_FORM); setModalError(null); setShowAssessmentLevelModal(true); }}
            addLabel="Add Assessment Level"
            headers={['Classification', 'Property Type', 'Level', 'Effective Date', 'Legal Source', 'Status']}
            loading={tabLoading.assessment_levels}
            isEmpty={assessmentLevels.length === 0}
            emptyIcon={<FileText className="h-8 w-8" />}
            emptyTitle="No assessment levels configured"
            emptyDescription="Add assessment levels that determine the assessed value from market value per classification."
          >
            {assessmentLevels.map((a) => (
              <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{capitalize(a.classification)}</td>
                <td className="px-4 py-3 text-gray-700">{capitalize(a.property_type)}</td>
                <td className="px-4 py-3 text-gray-700">{formatPercent(a.level_percent)}</td>
                <td className="px-4 py-3 text-gray-700">{formatDate(a.effective_date)}</td>
                <td className="px-4 py-3 text-gray-500">{a.legal_source || '—'}</td>
                <td className="px-4 py-3 text-right"><Badge status={a.status} /></td>
              </tr>
            ))}
          </TableShell>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/*  Tab: Valuation Schedules                                            */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'valuation_schedules' && (
        <>
          {tabError.valuation_schedules && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {tabError.valuation_schedules}
            </div>
          )}
          <TableShell
            title="Valuation Schedules"
            count={valuationSchedules.length}
            onAdd={() => { setValuationForm(EMPTY_VALUATION_SCHEDULE_FORM); setModalError(null); setShowValuationModal(true); }}
            addLabel="Add Schedule"
            headers={['Name', 'Version', 'Status', 'Publication Date', 'Effectivity Date', 'Certification Ref.']}
            loading={tabLoading.valuation_schedules}
            isEmpty={valuationSchedules.length === 0}
            emptyIcon={<FileText className="h-8 w-8" />}
            emptyTitle="No valuation schedules configured"
            emptyDescription="Add a valuation schedule to track the schedule of market values (SMV) used for assessments."
          >
            {valuationSchedules.map((v) => (
              <tr key={v.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{v.name}</td>
                <td className="px-4 py-3 text-gray-700">{v.version}</td>
                <td className="px-4 py-3"><Badge status={v.status} /></td>
                <td className="px-4 py-3 text-gray-700">{formatDate(v.publication_date)}</td>
                <td className="px-4 py-3 text-gray-700">{formatDate(v.effectivity_date)}</td>
                <td className="px-4 py-3 text-gray-500">{v.certification_reference || '—'}</td>
              </tr>
            ))}
          </TableShell>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/*  Tab: Discount Rules                                                 */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'discount_rules' && (
        <>
          {tabError.discount_rules && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {tabError.discount_rules}
            </div>
          )}
          <TableShell
            title="Discount Rules"
            count={discountRules.length}
            onAdd={() => { setDiscountForm(EMPTY_DISCOUNT_RULE_FORM); setModalError(null); setShowDiscountModal(true); }}
            addLabel="Add Discount Rule"
            headers={['Name', 'Max Discount', 'Valid From', 'Valid Until', 'Ordinance Ref.', 'Status']}
            loading={tabLoading.discount_rules}
            isEmpty={discountRules.length === 0}
            emptyIcon={<Percent className="h-8 w-8" />}
            emptyTitle="No discount rules configured"
            emptyDescription="Add a discount rule to define early-payment incentives for taxpayers."
          >
            {discountRules.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{d.name}</td>
                <td className="px-4 py-3 text-gray-700">{formatPercent(d.max_percent)}</td>
                <td className="px-4 py-3 text-gray-700">{formatDate(d.valid_from)}</td>
                <td className="px-4 py-3 text-gray-700">{formatDate(d.valid_until)}</td>
                <td className="px-4 py-3 text-gray-500">{d.ordinance_reference || '—'}</td>
                <td className="px-4 py-3 text-right"><Badge status={d.status} /></td>
              </tr>
            ))}
          </TableShell>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/*  Tab: Due Dates                                                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'due_dates' && (
        <>
          {tabError.due_dates && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {tabError.due_dates}
            </div>
          )}
          <TableShell
            title="Due Dates"
            count={dueDates.length}
            onAdd={() => { setDueDateForm(EMPTY_DUE_DATE_FORM); setModalError(null); setShowDueDateModal(true); }}
            addLabel="Add Due Date"
            headers={['Tax Year', 'Quarter', 'Due Date']}
            loading={tabLoading.due_dates}
            isEmpty={dueDates.length === 0}
            emptyIcon={<Calendar className="h-8 w-8" />}
            emptyTitle="No due dates configured"
            emptyDescription="Add quarterly due dates that govern when property tax payments are due."
          >
            {dueDates.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{d.tax_year}</td>
                <td className="px-4 py-3 text-gray-700">Q{d.quarter}</td>
                <td className="px-4 py-3 text-gray-700">{formatDate(d.due_date)}</td>
              </tr>
            ))}
          </TableShell>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/*  Tab: Levy Types (display-only)                                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'levy_types' && (
        <>
          {tabError.levy_types && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {tabError.levy_types}
            </div>
          )}
          <Card className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3">
            <p className="text-sm text-blue-800">
              <strong>System-Defined:</strong> Levy types are pre-configured by the system and
              governed by the Local Government Code (R.A. 7160). They cannot be added or edited here.
            </p>
          </Card>
          <TableShell
            title="Levy Types"
            count={levyTypes.length}
            headers={['Code', 'Name', 'Description', 'Statutory Destination', 'Sharing Config', 'Active']}
            loading={tabLoading.levy_types}
            isEmpty={levyTypes.length === 0}
            emptyIcon={<Settings className="h-8 w-8" />}
            emptyTitle="No levy types found"
            emptyDescription="Levy types should be seeded by the system migration."
          >
            {levyTypes.map((l) => (
              <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs font-medium text-gray-900">{l.code}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{l.name}</td>
                <td className="px-4 py-3 text-gray-600 max-w-xs">{l.description || '—'}</td>
                <td className="px-4 py-3 text-gray-700">{l.statutory_destination || '—'}</td>
                <td className="px-4 py-3">
                  {l.sharing_config ? (
                    <code className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      {JSON.stringify(l.sharing_config)}
                    </code>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {l.is_active ? (
                    <Badge status="active" label="Yes" />
                  ) : (
                    <Badge status="inactive" label="No" />
                  )}
                </td>
              </tr>
            ))}
          </TableShell>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/*  Tab: Compliance Calendar                                            */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'compliance_calendar' && (
        <>
          {tabError.compliance_calendar && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {tabError.compliance_calendar}
            </div>
          )}
          <TableShell
            title="Compliance Calendar"
            count={complianceEntries.length}
            onAdd={() => { setComplianceForm(EMPTY_COMPLIANCE_FORM); setModalError(null); setShowComplianceModal(true); }}
            addLabel="Add Calendar Entry"
            headers={['Report Name', 'Reporting Authority', 'Period', 'Deadline', 'Status', 'Notes']}
            loading={tabLoading.compliance_calendar}
            isEmpty={complianceEntries.length === 0}
            emptyIcon={<Calendar className="h-8 w-8" />}
            emptyTitle="No compliance entries"
            emptyDescription="Add calendar entries to track statutory reporting deadlines."
          >
            {complianceEntries.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{c.report_name}</td>
                <td className="px-4 py-3 text-gray-700">{c.reporting_authority}</td>
                <td className="px-4 py-3 text-gray-700">{c.period}</td>
                <td className="px-4 py-3 text-gray-700">{formatDate(c.deadline)}</td>
                <td className="px-4 py-3"><Badge status={c.status} /></td>
                <td className="px-4 py-3 text-gray-500 max-w-xs">{c.notes || '—'}</td>
              </tr>
            ))}
          </TableShell>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/*  Modals                                                              */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {/* Add Tax Rate */}
      <Modal
        open={showTaxRateModal}
        onClose={() => setShowTaxRateModal(false)}
        title="Add Tax Rate"
      >
        {modalError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {modalError}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Levy Type"
            value={taxRateForm.levy_type}
            onChange={(v) => setTaxRateForm((p) => ({ ...p, levy_type: v }))}
            options={LEVY_TYPE_OPTIONS}
            placeholder="Select levy type"
            required
            className="sm:col-span-2"
          />
          <Input
            label="Rate (%)"
            type="number"
            value={taxRateForm.rate_percent}
            onChange={(v) => setTaxRateForm((p) => ({ ...p, rate_percent: v }))}
            placeholder="e.g. 2.00"
            required
          />
          <Input
            label="Effective Date"
            type="date"
            value={taxRateForm.effective_date}
            onChange={(v) => setTaxRateForm((p) => ({ ...p, effective_date: v }))}
            required
          />
          <Input
            label="Ordinance Reference"
            value={taxRateForm.ordinance_reference}
            onChange={(v) => setTaxRateForm((p) => ({ ...p, ordinance_reference: v }))}
            placeholder="e.g. Ord. No. 2024-001"
            className="sm:col-span-2"
          />
          <Input
            label="Legal Source"
            value={taxRateForm.legal_source}
            onChange={(v) => setTaxRateForm((p) => ({ ...p, legal_source: v }))}
            placeholder="e.g. R.A. 7160, Sec. 233"
            className="sm:col-span-2"
          />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={() => setShowTaxRateModal(false)}>Cancel</Button>
          <Button onClick={handleCreateTaxRate} disabled={saving}>
            {saving ? (
              <><div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" /> Saving...</>
            ) : (
              <><Save className="h-4 w-4" /> Save Tax Rate</>
            )}
          </Button>
        </div>
      </Modal>

      {/* Add Assessment Level */}
      <Modal
        open={showAssessmentLevelModal}
        onClose={() => setShowAssessmentLevelModal(false)}
        title="Add Assessment Level"
      >
        {modalError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {modalError}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Classification"
            value={assessmentLevelForm.classification}
            onChange={(v) => setAssessmentLevelForm((p) => ({ ...p, classification: v }))}
            options={CLASSIFICATION_OPTIONS}
            placeholder="Select classification"
            required
          />
          <Select
            label="Property Type"
            value={assessmentLevelForm.property_type}
            onChange={(v) => setAssessmentLevelForm((p) => ({ ...p, property_type: v }))}
            options={PROPERTY_TYPE_OPTIONS}
            placeholder="Select property type"
            required
          />
          <Input
            label="Assessment Level (%)"
            type="number"
            value={assessmentLevelForm.level_percent}
            onChange={(v) => setAssessmentLevelForm((p) => ({ ...p, level_percent: v }))}
            placeholder="e.g. 20.00"
            required
          />
          <Input
            label="Effective Date"
            type="date"
            value={assessmentLevelForm.effective_date}
            onChange={(v) => setAssessmentLevelForm((p) => ({ ...p, effective_date: v }))}
            required
          />
          <Input
            label="Legal Source"
            value={assessmentLevelForm.legal_source}
            onChange={(v) => setAssessmentLevelForm((p) => ({ ...p, legal_source: v }))}
            placeholder="e.g. R.A. 7160, Sec. 218"
            className="sm:col-span-2"
          />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={() => setShowAssessmentLevelModal(false)}>Cancel</Button>
          <Button onClick={handleCreateAssessmentLevel} disabled={saving}>
            {saving ? (
              <><div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" /> Saving...</>
            ) : (
              <><Save className="h-4 w-4" /> Save Assessment Level</>
            )}
          </Button>
        </div>
      </Modal>

      {/* Add Valuation Schedule */}
      <Modal
        open={showValuationModal}
        onClose={() => setShowValuationModal(false)}
        title="Add Valuation Schedule"
        size="lg"
      >
        {modalError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {modalError}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Schedule Name"
            value={valuationForm.name}
            onChange={(v) => setValuationForm((p) => ({ ...p, name: v }))}
            placeholder="e.g. Schedule of Market Values"
            required
          />
          <Input
            label="Version"
            value={valuationForm.version}
            onChange={(v) => setValuationForm((p) => ({ ...p, version: v }))}
            placeholder="e.g. 2024-01"
            required
          />
          <Select
            label="Status"
            value={valuationForm.status}
            onChange={(v) => setValuationForm((p) => ({ ...p, status: v }))}
            options={VALUATION_STATUS_OPTIONS}
          />
          <div />
          <Input
            label="Publication Date"
            type="date"
            value={valuationForm.publication_date}
            onChange={(v) => setValuationForm((p) => ({ ...p, publication_date: v }))}
          />
          <Input
            label="Effectivity Date"
            type="date"
            value={valuationForm.effectivity_date}
            onChange={(v) => setValuationForm((p) => ({ ...p, effectivity_date: v }))}
          />
          <Input
            label="Certification Reference"
            value={valuationForm.certification_reference}
            onChange={(v) => setValuationForm((p) => ({ ...p, certification_reference: v }))}
            placeholder="e.g. Cert. No. 2024-SMV-001"
            className="sm:col-span-2"
          />
          <Input
            label="Legal Source"
            value={valuationForm.legal_source}
            onChange={(v) => setValuationForm((p) => ({ ...p, legal_source: v }))}
            placeholder="e.g. Prov. Ord. 2024-05"
            className="sm:col-span-2"
          />
          <TextArea
            label="Notes"
            value={valuationForm.notes}
            onChange={(v) => setValuationForm((p) => ({ ...p, notes: v }))}
            placeholder="Additional notes about this schedule..."
            rows={3}
            className="sm:col-span-2"
          />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={() => setShowValuationModal(false)}>Cancel</Button>
          <Button onClick={handleCreateValuationSchedule} disabled={saving}>
            {saving ? (
              <><div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" /> Saving...</>
            ) : (
              <><Save className="h-4 w-4" /> Save Schedule</>
            )}
          </Button>
        </div>
      </Modal>

      {/* Add Discount Rule */}
      <Modal
        open={showDiscountModal}
        onClose={() => setShowDiscountModal(false)}
        title="Add Discount Rule"
      >
        {modalError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {modalError}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Rule Name"
            value={discountForm.name}
            onChange={(v) => setDiscountForm((p) => ({ ...p, name: v }))}
            placeholder="e.g. Advance Payment Discount"
            required
            className="sm:col-span-2"
          />
          <Input
            label="Max Discount (%)"
            type="number"
            value={discountForm.max_percent}
            onChange={(v) => setDiscountForm((p) => ({ ...p, max_percent: v }))}
            placeholder="e.g. 20.00"
            required
          />
          <div />
          <Input
            label="Valid From"
            type="date"
            value={discountForm.valid_from}
            onChange={(v) => setDiscountForm((p) => ({ ...p, valid_from: v }))}
            required
          />
          <Input
            label="Valid Until"
            type="date"
            value={discountForm.valid_until}
            onChange={(v) => setDiscountForm((p) => ({ ...p, valid_until: v }))}
          />
          <Input
            label="Ordinance Reference"
            value={discountForm.ordinance_reference}
            onChange={(v) => setDiscountForm((p) => ({ ...p, ordinance_reference: v }))}
            placeholder="e.g. Ord. No. 2024-010"
            className="sm:col-span-2"
          />
          <TextArea
            label="Eligibility Criteria"
            value={discountForm.eligibility_criteria}
            onChange={(v) => setDiscountForm((p) => ({ ...p, eligibility_criteria: v }))}
            placeholder="Describe who qualifies for this discount..."
            rows={2}
            className="sm:col-span-2"
          />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={() => setShowDiscountModal(false)}>Cancel</Button>
          <Button onClick={handleCreateDiscountRule} disabled={saving}>
            {saving ? (
              <><div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" /> Saving...</>
            ) : (
              <><Save className="h-4 w-4" /> Save Discount Rule</>
            )}
          </Button>
        </div>
      </Modal>

      {/* Add Due Date */}
      <Modal
        open={showDueDateModal}
        onClose={() => setShowDueDateModal(false)}
        title="Add Due Date"
      >
        {modalError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {modalError}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Tax Year"
            type="number"
            value={dueDateForm.tax_year}
            onChange={(v) => setDueDateForm((p) => ({ ...p, tax_year: v }))}
            placeholder="e.g. 2025"
            required
          />
          <Select
            label="Quarter"
            value={dueDateForm.quarter}
            onChange={(v) => setDueDateForm((p) => ({ ...p, quarter: v }))}
            options={QUARTER_OPTIONS}
            placeholder="Select quarter"
            required
          />
          <Input
            label="Due Date"
            type="date"
            value={dueDateForm.due_date}
            onChange={(v) => setDueDateForm((p) => ({ ...p, due_date: v }))}
            required
            className="sm:col-span-2"
          />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={() => setShowDueDateModal(false)}>Cancel</Button>
          <Button onClick={handleCreateDueDate} disabled={saving}>
            {saving ? (
              <><div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" /> Saving...</>
            ) : (
              <><Save className="h-4 w-4" /> Save Due Date</>
            )}
          </Button>
        </div>
      </Modal>

      {/* Add Compliance Calendar Entry */}
      <Modal
        open={showComplianceModal}
        onClose={() => setShowComplianceModal(false)}
        title="Add Calendar Entry"
        size="lg"
      >
        {modalError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {modalError}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Report Name"
            value={complianceForm.report_name}
            onChange={(v) => setComplianceForm((p) => ({ ...p, report_name: v }))}
            placeholder="e.g. Quarterly RPT Collection Report"
            required
            className="sm:col-span-2"
          />
          <Input
            label="Reporting Authority"
            value={complianceForm.reporting_authority}
            onChange={(v) => setComplianceForm((p) => ({ ...p, reporting_authority: v }))}
            placeholder="e.g. BLGF Regional Office"
            required
          />
          <Input
            label="Period"
            value={complianceForm.period}
            onChange={(v) => setComplianceForm((p) => ({ ...p, period: v }))}
            placeholder="e.g. Q1 2025"
            required
          />
          <Input
            label="Deadline"
            type="date"
            value={complianceForm.deadline}
            onChange={(v) => setComplianceForm((p) => ({ ...p, deadline: v }))}
            required
          />
          <Select
            label="Status"
            value={complianceForm.status}
            onChange={(v) => setComplianceForm((p) => ({ ...p, status: v }))}
            options={COMPLIANCE_STATUS_OPTIONS}
          />
          <TextArea
            label="Notes"
            value={complianceForm.notes}
            onChange={(v) => setComplianceForm((p) => ({ ...p, notes: v }))}
            placeholder="Additional notes..."
            rows={2}
            className="sm:col-span-2"
          />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={() => setShowComplianceModal(false)}>Cancel</Button>
          <Button onClick={handleCreateComplianceEntry} disabled={saving}>
            {saving ? (
              <><div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" /> Saving...</>
            ) : (
              <><Save className="h-4 w-4" /> Save Entry</>
            )}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
