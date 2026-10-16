import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calculator, Search, FileText, Plus, AlertCircle,
  CheckCircle2, Loader2, ChevronRight, Receipt,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, Badge, Button, Modal, Input, Select, EmptyState, PageHeader } from '@/components/ui';
import { formatCurrency, formatDate, computeInterest, capitalize } from '@/lib/utils';
import { LEVY_TYPES } from '@/lib/constants';
import type { TaxCharge } from '@/lib/types';

/* ────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

/** Shape returned by the joined tax_charges query. */
interface TaxChargeWithJoins extends Omit<TaxCharge, 'property' | 'property_unit' | 'assessment'> {
  property: { pin: string | null; tax_declaration_number: string | null } | null;
  property_unit: { unit_type: string; classification: string } | null;
  assessment: {
    market_value: number;
    assessment_level_percent: number;
    assessed_value: number;
  } | null;
}

/** A charge augmented with live interest computed in the browser. */
interface ChargeWithInterest extends TaxChargeWithJoins {
  interest_accrued: number;
  total_due: number;
}

/** Statement tree: year → quarter → charges. */
interface StatementTree {
  [year: number]: {
    [quarter: number]: ChargeWithInterest[];
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Constants                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

const CHARGE_STATUSES = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partially_paid', label: 'Partially Paid' },
  { value: 'paid', label: 'Paid' },
];

const QUARTERS = [1, 2, 3, 4];

const LEVY_OPTIONS = LEVY_TYPES.map((l) => ({ value: l.code, label: l.name }));

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** Decorate a raw charge with live interest and total-due figures. */
function withInterest(charge: TaxChargeWithJoins, asOf = new Date()): ChargeWithInterest {
  const balance = charge.balance ?? 0;
  const interest = balance > 0 ? computeInterest(balance, charge.due_date, asOf) : 0;
  return {
    ...charge,
    interest_accrued: interest,
    total_due: balance + interest,
  };
}

/** Get a human label for a levy code. */
function levyLabel(code: string): string {
  return LEVY_TYPES.find((l) => l.code === code)?.name ?? capitalize(code);
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Component                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export function BillingPage() {
  /* ── State: list view ─────────────────────────────────────────────────── */
  const [charges, setCharges] = useState<ChargeWithInterest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchPin, setSearchPin] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterQuarter, setFilterQuarter] = useState('');
  const [filterLevy, setFilterLevy] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Summary
  const [summary, setSummary] = useState({
    totalBilled: 0,
    totalCollected: 0,
    totalBalance: 0,
    totalInterest: 0,
  });

  /* ── State: statement modal ───────────────────────────────────────────── */
  const [statementCharges, setStatementCharges] = useState<ChargeWithInterest[]>([]);
  const [statementProperty, setStatementProperty] = useState<{
    pin: string | null;
    td: string | null;
  } | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);

  /* ── State: generate billing modal ────────────────────────────────────── */
  const [genOpen, setGenOpen] = useState(false);
  const [genYear, setGenYear] = useState(String(new Date().getFullYear()));
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<{
    generated: number;
    skipped: number;
    message: string;
  } | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  /* ── Data loading ─────────────────────────────────────────────────────── */

  const loadCharges = useCallback(async () => {
    setLoading(true);
    setError(null);

    let query = supabase
      .from('tax_charges')
      .select<string, TaxChargeWithJoins>(`
        *,
        property:properties!property_id(pin, tax_declaration_number),
        property_unit:property_units!property_unit_id(unit_type, classification),
        assessment:assessments!assessment_id(market_value, assessment_level_percent, assessed_value)
      `)
      .order('tax_year', { ascending: false })
      .order('quarter', { ascending: true })
      .order('levy_type', { ascending: true });

    if (filterYear) query = query.eq('tax_year', Number(filterYear));
    if (filterQuarter) query = query.eq('quarter', Number(filterQuarter));
    if (filterLevy) query = query.eq('levy_type', filterLevy);
    if (filterStatus) query = query.eq('status', filterStatus);

    // PIN search — PostgREST `or` with `ilike` on the joined property.
    if (searchPin.trim()) {
      const term = searchPin.trim();
      query = query.or(
        `property.pin.ilike.%${term}%,property.tax_declaration_number.ilike.%${term}%`
      );
    }

    const { data, error: fetchError } = await query.limit(500);

    if (fetchError) {
      setError(fetchError.message);
      setCharges([]);
      setLoading(false);
      return;
    }

    const decorated = (data ?? []).map((c) => withInterest(c));
    setCharges(decorated);

    // Compute summary from the decorated set.
    const totalBilled = decorated.reduce((s, c) => s + (c.gross_amount ?? 0), 0);
    const totalCollected = decorated.reduce((s, c) => s + (c.paid_amount ?? 0), 0);
    const totalBalance = decorated.reduce((s, c) => s + (c.balance ?? 0), 0);
    const totalInterest = decorated.reduce((s, c) => s + c.interest_accrued, 0);
    setSummary({ totalBilled, totalCollected, totalBalance, totalInterest });

    setLoading(false);
  }, [filterYear, filterQuarter, filterLevy, filterStatus, searchPin]);

  useEffect(() => {
    loadCharges();
  }, [loadCharges]);

  /* ── Tax statement for a single property ──────────────────────────────── */

  async function openStatement(propertyId: string, pin: string | null, td: string | null) {
    setStatementProperty({ pin, td });
    setStatementOpen(true);
    setStatementLoading(true);

    const { data, error: fetchError } = await supabase
      .from('tax_charges')
      .select<string, TaxChargeWithJoins>(`
        *,
        property:properties!property_id(pin, tax_declaration_number),
        property_unit:property_units!property_unit_id(unit_type, classification),
        assessment:assessments!assessment_id(market_value, assessment_level_percent, assessed_value)
      `)
      .eq('property_id', propertyId)
      .neq('status', 'cancelled')
      .order('tax_year', { ascending: true })
      .order('quarter', { ascending: true })
      .order('levy_type', { ascending: true });

    if (fetchError) {
      setStatementCharges([]);
      setStatementLoading(false);
      return;
    }

    setStatementCharges((data ?? []).map((c) => withInterest(c)));
    setStatementLoading(false);
  }

  /* ── Generate billing ─────────────────────────────────────────────────── */

  async function generateBilling() {
    setGenerating(true);
    setGenError(null);
    setGenResult(null);

    const year = Number(genYear);
    if (!year || year < 2000) {
      setGenError('Please enter a valid tax year.');
      setGenerating(false);
      return;
    }

    try {
          // Charge calculation, validation, and insertion run in one database transaction.
      const { data, error } = await supabase.rpc('generate_rpt_charges', {
        p_tax_year: year,
      });
      if (error) throw new Error(error.message);

      const result = data as { generated: number; skipped: number; message: string };
      setGenResult(result);
      if (result.generated > 0) loadCharges();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'An unexpected error occurred during billing generation.');
    } finally {
      setGenerating(false);
    }
  }

  /* ── Derived: statement tree ───────────────────────────────────────────── */

  const statementTree = useMemo<StatementTree>(() => {
    const tree: StatementTree = {};
    for (const c of statementCharges) {
      if (!tree[c.tax_year]) tree[c.tax_year] = {};
      if (!tree[c.tax_year][c.quarter]) tree[c.tax_year][c.quarter] = [];
      tree[c.tax_year][c.quarter].push(c);
    }
    return tree;
  }, [statementCharges]);

  const statementGrandTotal = useMemo(() => {
    let balance = 0;
    let interest = 0;
    for (const c of statementCharges) {
      balance += c.balance ?? 0;
      interest += c.interest_accrued;
    }
    return { balance, interest, total: balance + interest };
  }, [statementCharges]);

  /* ── Available years for filter dropdown ──────────────────────────────── */

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const c of charges) years.add(c.tax_year);
    years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [charges]);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  Render                                                                     */
  /* ──────────────────────────────────────────────────────────────────────── */

  return (
    <div>
      <PageHeader
        title="Billing & Tax Computation"
        description="Manage real property tax charges, view tax statements, and generate quarterly billing."
        action={
          <Button onClick={() => { setGenResult(null); setGenError(null); setGenOpen(true); }}>
            <Plus className="h-4 w-4" />
            Generate Billing
          </Button>
        }
      />

      {/* ── Summary cards ────────────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <p className="text-sm font-medium text-gray-500">Total Billed (filtered)</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{formatCurrency(summary.totalBilled)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-gray-500">Total Collected</p>
          <p className="mt-1 text-2xl font-bold text-green-700">{formatCurrency(summary.totalCollected)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-gray-500">Outstanding Balance</p>
          <p className="mt-1 text-2xl font-bold text-red-700">{formatCurrency(summary.totalBalance)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-gray-500">Interest Accrued</p>
          <p className="mt-1 text-2xl font-bold text-orange-700">{formatCurrency(summary.totalInterest)}</p>
        </Card>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <Input
              label="Search PIN / TD No."
              value={searchPin}
              onChange={setSearchPin}
              placeholder="e.g. 123-456 or TD-2024..."
            />
          </div>
          <Select
            label="Tax Year"
            value={filterYear}
            onChange={setFilterYear}
            placeholder="All Years"
            options={availableYears.map((y) => ({ value: String(y), label: `CY ${y}` }))}
          />
          <Select
            label="Quarter"
            value={filterQuarter}
            onChange={setFilterQuarter}
            placeholder="All Quarters"
            options={QUARTERS.map((q) => ({ value: String(q), label: `Q${q}` }))}
          />
          <Select
            label="Levy Type"
            value={filterLevy}
            onChange={setFilterLevy}
            placeholder="All Levy Types"
            options={LEVY_OPTIONS}
          />
          <Select
            label="Status"
            value={filterStatus}
            onChange={setFilterStatus}
            placeholder="All Statuses"
            options={CHARGE_STATUSES}
          />
        </div>
        {(filterYear || filterQuarter || filterLevy || filterStatus || searchPin) && (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Showing {charges.length} charge{charges.length !== 1 ? 's' : ''}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchPin('');
                setFilterYear('');
                setFilterQuarter('');
                setFilterLevy('');
                setFilterStatus('');
              }}
            >
              Clear Filters
            </Button>
          </div>
        )}
      </Card>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Charges table ────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-blue-700" />
          </div>
        ) : charges.length === 0 ? (
          <EmptyState
            icon={<Calculator className="h-8 w-8" />}
            title="No Tax Charges Found"
            description="Adjust your filters or generate billing for a tax year to create charges."
            action={
              <Button onClick={() => { setGenResult(null); setGenError(null); setGenOpen(true); }}>
                <Plus className="h-4 w-4" />
                Generate Billing
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Property PIN</th>
                  <th className="px-4 py-3">Tax Year / Qtr</th>
                  <th className="px-4 py-3">Levy Type</th>
                  <th className="px-4 py-3 text-right">Gross</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">Interest</th>
                  <th className="px-4 py-3 text-right">Total Due</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {charges.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {c.property?.pin || c.property?.tax_declaration_number || '—'}
                      </div>
                      {c.property_unit && (
                        <div className="text-xs text-gray-500">
                          {capitalize(c.property_unit.unit_type)} • {capitalize(c.property_unit.classification)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                      <span className="font-medium">{c.tax_year}</span>
                      <span className="text-gray-400"> · Q{c.quarter}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{levyLabel(c.levy_type)}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                      {formatCurrency(c.gross_amount)}
                    </td>
                    <td className="px-4 py-3 text-right text-green-700 whitespace-nowrap">
                      {formatCurrency(c.paid_amount)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                      {formatCurrency(c.balance)}
                    </td>
                    <td className="px-4 py-3 text-right text-orange-600 whitespace-nowrap">
                      {c.interest_accrued > 0 ? formatCurrency(c.interest_accrued) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                      {formatCurrency(c.total_due)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                      {formatDate(c.due_date)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() =>
                          openStatement(c.property_id, c.property?.pin ?? null, c.property?.tax_declaration_number ?? null)
                        }
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
                        title="View tax statement"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Statement
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/*  Tax Statement Modal                                                   */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <Modal
        open={statementOpen}
        onClose={() => setStatementOpen(false)}
        title={`Tax Statement — ${statementProperty?.pin || statementProperty?.td || 'Property'}`}
        size="xl"
      >
        {statementLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-blue-700" />
          </div>
        ) : statementCharges.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-8 w-8" />}
            title="No Charges"
            description="This property has no active tax charges on record."
          />
        ) : (
          <div className="space-y-6">
            <p className="text-xs text-gray-500">
              Statement as of {formatDate(new Date())}. Interest is computed at 2% per month on
              overdue balances, up to a maximum of 36 months.
            </p>

            {/* Assessment detail card (from first charge that has assessment data) */}
            {(() => {
              const withAssessment = statementCharges.find((c) => c.assessment);
              if (!withAssessment?.assessment) return null;
              const basis = withAssessment.charge_basis as Record<string, unknown> | null;
              return (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <h4 className="mb-3 text-sm font-semibold text-gray-900">Assessment & Computation Basis</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-gray-500">Market Value</p>
                      <p className="font-medium text-gray-900">{formatCurrency(withAssessment.assessment.market_value)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Assessment Level</p>
                      <p className="font-medium text-gray-900">{withAssessment.assessment.assessment_level_percent}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Assessed Value</p>
                      <p className="font-medium text-gray-900">{formatCurrency(withAssessment.assessment.assessed_value)}</p>
                    </div>
                    {basis && (
                      <>
                        <div>
                          <p className="text-xs text-gray-500">Basic Rate</p>
                          <p className="font-medium text-gray-900">{String(basis.basic_rate ?? '—')}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">SEF Rate</p>
                          <p className="font-medium text-gray-900">{String(basis.sef_rate ?? '—')}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Annual Basic Tax</p>
                          <p className="font-medium text-gray-900">{formatCurrency(Number(basis.annual_basic ?? 0))}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Annual SEF Tax</p>
                          <p className="font-medium text-gray-900">{formatCurrency(Number(basis.annual_sef ?? 0))}</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Year → Quarter → Charges */}
            {Object.entries(statementTree)
              .sort(([a], [b]) => Number(b) - Number(a))
              .map(([year, quarters]) => {
                const yearCharges = (Object.values(quarters) as ChargeWithInterest[][]).flat();
                const yearBalance = yearCharges.reduce((s: number, c: ChargeWithInterest) => s + (c.balance ?? 0), 0);
                const yearInterest = yearCharges.reduce((s: number, c: ChargeWithInterest) => s + c.interest_accrued, 0);

                return (
                  <div key={year} className="overflow-hidden rounded-lg border border-gray-200">
                    <div className="flex items-center justify-between bg-gray-100 px-4 py-2">
                      <h4 className="text-sm font-bold text-gray-900">Tax Year {year}</h4>
                      <div className="text-sm text-gray-700">
                        <span className="mr-4">Balance: <strong>{formatCurrency(yearBalance)}</strong></span>
                        <span className="mr-4">Interest: <strong className="text-orange-600">{formatCurrency(yearInterest)}</strong></span>
                        <span>Total: <strong>{formatCurrency(yearBalance + yearInterest)}</strong></span>
                      </div>
                    </div>

                    {Object.entries(quarters)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([quarter, qCharges]) => (
                        <div key={quarter}>
                          <div className="bg-gray-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Quarter {quarter}
                          </div>
                          <table className="w-full text-sm">
                            <thead className="text-left text-xs text-gray-400">
                              <tr>
                                <th className="px-4 py-2 font-medium">Levy Type</th>
                                <th className="px-4 py-2 text-right font-medium">Gross</th>
                                <th className="px-4 py-2 text-right font-medium">Paid</th>
                                <th className="px-4 py-2 text-right font-medium">Balance</th>
                                <th className="px-4 py-2 text-right font-medium">Interest</th>
                                <th className="px-4 py-2 text-right font-medium">Net Due</th>
                                <th className="px-4 py-2 font-medium">Due Date</th>
                                <th className="px-4 py-2 font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {(qCharges as ChargeWithInterest[]).map((c) => (
                                <tr key={c.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-gray-900">{levyLabel(c.levy_type)}</td>
                                  <td className="px-4 py-2 text-right text-gray-700 whitespace-nowrap">{formatCurrency(c.gross_amount)}</td>
                                  <td className="px-4 py-2 text-right text-green-700 whitespace-nowrap">{formatCurrency(c.paid_amount)}</td>
                                  <td className="px-4 py-2 text-right text-gray-900 whitespace-nowrap">{formatCurrency(c.balance)}</td>
                                  <td className="px-4 py-2 text-right text-orange-600 whitespace-nowrap">
                                    {c.interest_accrued > 0 ? formatCurrency(c.interest_accrued) : '—'}
                                  </td>
                                  <td className="px-4 py-2 text-right font-semibold text-gray-900 whitespace-nowrap">
                                    {formatCurrency(c.total_due)}
                                  </td>
                                  <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{formatDate(c.due_date)}</td>
                                  <td className="px-4 py-2"><Badge status={c.status} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                  </div>
                );
              })}

            {/* Grand total */}
            <div className="flex items-center justify-between rounded-lg bg-blue-50 px-5 py-4">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-blue-700" />
                <span className="text-sm font-bold text-gray-900">Grand Total Due</span>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">
                  Balance {formatCurrency(statementGrandTotal.balance)} + Interest {formatCurrency(statementGrandTotal.interest)}
                </p>
                <p className="text-2xl font-bold text-blue-900">{formatCurrency(statementGrandTotal.total)}</p>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/*  Generate Billing Modal                                               */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <Modal
        open={genOpen}
        onClose={() => !generating && setGenOpen(false)}
        title="Generate Tax Billing"
        size="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg bg-blue-50 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" />
            <p className="text-sm text-blue-800">
              This will generate quarterly tax charges (basic + SEF) for all approved assessments
              for the selected tax year. Charges that already exist will be skipped.
            </p>
          </div>

          <Input
            label="Tax Year"
            type="number"
            value={genYear}
            onChange={setGenYear}
            required
            placeholder="e.g. 2025"
          />

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
            <p className="mb-2 font-medium text-gray-700">Computation Summary</p>
            <ul className="space-y-1 text-xs">
              <li className="flex items-center gap-2">
                <ChevronRight className="h-3 w-3 text-gray-400" />
                Uses the latest approved assessment for each active, non-exempt property unit
              </li>
              <li className="flex items-center gap-2">
                <ChevronRight className="h-3 w-3 text-gray-400" />
                Annual Basic Tax = Assessed Value × Basic Rate ÷ 100
              </li>
              <li className="flex items-center gap-2">
                <ChevronRight className="h-3 w-3 text-gray-400" />
                Annual SEF Tax = Assessed Value × SEF Rate ÷ 100
              </li>
              <li className="flex items-center gap-2">
                <ChevronRight className="h-3 w-3 text-gray-400" />
                Quarterly amounts are split in centavos so all four quarters equal the annual charge
              </li>
              <li className="flex items-center gap-2">
                <ChevronRight className="h-3 w-3 text-gray-400" />
                Due dates sourced from the <code className="rounded bg-gray-200 px-1">due_dates</code> table
              </li>
              <li className="flex items-center gap-2">
                <ChevronRight className="h-3 w-3 text-gray-400" />
                Server-side billing requires effective rates, an authorized levying jurisdiction, and ordinance references
              </li>
            </ul>
          </div>

          {genError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{genError}</span>
            </div>
          )}

          {genResult && (
            <div className="flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <p>{genResult.message}</p>
                {genResult.skipped > 0 && (
                  <p className="mt-1 text-xs text-green-600">
                    {genResult.skipped} assessment(s) skipped — charges already exist for CY {genYear}.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setGenOpen(false)} disabled={generating}>
              {genResult ? 'Close' : 'Cancel'}
            </Button>
            {!genResult && (
              <Button onClick={generateBilling} disabled={generating}>
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Calculator className="h-4 w-4" />
                    Generate Charges
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
