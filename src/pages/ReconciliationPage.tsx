import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, Badge, Button, EmptyState, PageHeader, StatCard } from '@/components/ui';
import { formatCurrency, formatDateTime, formatDate, capitalize } from '@/lib/utils';
import { Scale, Building, Landmark, Banknote, ArrowRightLeft } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

/** Payment allocation augmented with the joined payment and tax charge data. */
interface AllocationWithJoins {
  id: string;
  payment_id: string;
  tax_charge_id: string;
  allocated_amount: number;
  principal_amount: number;
  interest_amount: number;
  discount_amount: number;
  share_province: number;
  share_municipality: number;
  share_barangay: number;
  share_sef_province: number;
  share_sef_municipality: number;
  created_at: string;
  payment: { payer_name: string; payment_date: string; status: string } | null;
  tax_charge: {
    levy_type: string;
    tax_year: number;
    quarter: number;
    property: { pin: string | null } | null;
  } | null;
}

/** Payment augmented with its receipt(s). PostgREST may return an object or an
 *  array depending on the cardinality it infers, so we accept both. */
interface PaymentWithJoins {
  id: string;
  receipt_id: string | null;
  property_id: string | null;
  taxpayer_id: string | null;
  payer_name: string;
  payer_type: string;
  payment_method: 'cash' | 'check' | 'bank_transfer' | 'online';
  tender_amount: number;
  total_allocated: number;
  change_amount: number;
  payment_date: string;
  settlement_date: string | null;
  status: string;
  cash_session_id: string | null;
  collected_by: string | null;
  notes: string | null;
  created_at: string;
  receipts:
    | { receipt_number: string; status: string }
    | { receipt_number: string; status: string }[]
    | null;
}

/** Revenue-sharing recipient descriptor. */
interface Recipient {
  key: string;
  name: string;
  description: string;
  shareField: keyof Pick<
    AllocationWithJoins,
    'share_province' | 'share_municipality' | 'share_barangay' | 'share_sef_province' | 'share_sef_municipality'
  >;
  color: 'blue' | 'teal' | 'green' | 'purple' | 'orange';
  icon: typeof Scale;
}

/** Daily reconciliation aggregate. */
interface DailyReconciliation {
  date: string;
  paymentCount: number;
  receiptCount: number;
  totalCollected: number;
  byMethod: Record<string, { count: number; amount: number }>;
  byStatus: Record<string, number>;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Constants                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

const RECIPIENTS: Recipient[] = [
  {
    key: 'province',
    name: 'Quezon Province',
    description: '35% of Basic RPT',
    shareField: 'share_province',
    color: 'blue',
    icon: Landmark,
  },
  {
    key: 'municipality',
    name: 'Lopez Municipality',
    description: '40% of Basic RPT',
    shareField: 'share_municipality',
    color: 'teal',
    icon: Building,
  },
  {
    key: 'barangay',
    name: 'Barangay',
    description: '25% of Basic RPT',
    shareField: 'share_barangay',
    color: 'green',
    icon: Scale,
  },
  {
    key: 'sef_province',
    name: 'Provincial SEF',
    description: '50% of SEF',
    shareField: 'share_sef_province',
    color: 'purple',
    icon: Banknote,
  },
  {
    key: 'sef_municipality',
    name: 'Municipal SEF',
    description: '50% of SEF',
    shareField: 'share_sef_municipality',
    color: 'orange',
    icon: Banknote,
  },
];

const TABS = [
  { key: 'summary', label: 'Revenue Sharing', icon: Scale },
  { key: 'allocations', label: 'Allocations', icon: Banknote },
  { key: 'reconciliation', label: 'Reconciliation', icon: ArrowRightLeft },
  { key: 'remittance', label: 'Remittance', icon: Landmark },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const PAYMENT_METHODS: PaymentWithJoins['payment_method'][] = [
  'cash',
  'check',
  'bank_transfer',
  'online',
];

/** Statuses surfaced in the reconciliation distribution, in display order. */
const RECON_STATUS_ORDER = [
  'confirmed',
  'receipted',
  'settled',
  'reconciled',
  'reversed',
  'initiated',
  'failed',
];

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** Human label for a levy code. */
function levyLabel(code: string): string {
  if (code === 'sef') return 'SEF';
  if (code === 'idle_land') return 'Idle Land';
  return capitalize(code);
}

/** Normalize the polymorphic receipts join into a single receipt (or null). */
function firstReceipt(
  r: PaymentWithJoins['receipts']
): { receipt_number: string; status: string } | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  return r;
}

/** Stable YYYY-MM-DD key for a payment date (local time). */
function dayKey(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Component                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export function ReconciliationPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('summary');
  const [allocations, setAllocations] = useState<AllocationWithJoins[]>([]);
  const [payments, setPayments] = useState<PaymentWithJoins[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── Data loading ─────────────────────────────────────────────────────── */

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [allocRes, payRes] = await Promise.all([
      supabase
        .from('payment_allocations')
        .select<string, AllocationWithJoins>(`
          *,
          payment:payments(payer_name, payment_date, status),
          tax_charge:tax_charges(levy_type, tax_year, quarter, property:properties!property_id(pin))
        `)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('payments')
        .select<string, PaymentWithJoins>('*, receipts(receipt_number, status)')
        .order('payment_date', { ascending: false })
        .limit(100),
    ]);

    if (allocRes.error) {
      setError(allocRes.error.message);
      setAllocations([]);
      setPayments([]);
      setLoading(false);
      return;
    }
    if (payRes.error) {
      setError(payRes.error.message);
      setAllocations([]);
      setPayments([]);
      setLoading(false);
      return;
    }

    setAllocations((allocRes.data as AllocationWithJoins[] | null) ?? []);
    setPayments((payRes.data as PaymentWithJoins[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* ── Derived: revenue sharing summary ─────────────────────────────────── */

  const sharingSummary = useMemo(() => {
    const sums = {
      share_province: 0,
      share_municipality: 0,
      share_barangay: 0,
      share_sef_province: 0,
      share_sef_municipality: 0,
      allocated: 0,
    };
    for (const a of allocations) {
      sums.share_province += a.share_province ?? 0;
      sums.share_municipality += a.share_municipality ?? 0;
      sums.share_barangay += a.share_barangay ?? 0;
      sums.share_sef_province += a.share_sef_province ?? 0;
      sums.share_sef_municipality += a.share_sef_municipality ?? 0;
      sums.allocated += a.allocated_amount ?? 0;
    }
    const basicTotal =
      sums.share_province + sums.share_municipality + sums.share_barangay;
    const sefTotal = sums.share_sef_province + sums.share_sef_municipality;
    return { ...sums, basicTotal, sefTotal, grandTotal: basicTotal + sefTotal };
  }, [allocations]);

  /* ── Derived: daily reconciliation ────────────────────────────────────── */

  const dailyReconciliation = useMemo<DailyReconciliation[]>(() => {
    const map = new Map<string, DailyReconciliation>();
    for (const p of payments) {
      const key = dayKey(p.payment_date);
      let day = map.get(key);
      if (!day) {
        day = {
          date: key,
          paymentCount: 0,
          receiptCount: 0,
          totalCollected: 0,
          byMethod: {},
          byStatus: {},
        };
        map.set(key, day);
      }
      day.paymentCount += 1;
      day.totalCollected += p.total_allocated ?? 0;
      if (firstReceipt(p.receipts)) day.receiptCount += 1;

      const method = p.payment_method ?? 'cash';
      const m = (day.byMethod[method] ?? { count: 0, amount: 0 });
      m.count += 1;
      m.amount += p.total_allocated ?? 0;
      day.byMethod[method] = m;

      const status = p.status ?? 'initiated';
      day.byStatus[status] = (day.byStatus[status] ?? 0) + 1;
    }
    return Array.from(map.values()).sort((a, b) =>
      a.date < b.date ? 1 : -1
    );
  }, [payments]);

  const reconciliationTotals = useMemo(() => {
    const totals = {
      payments: payments.length,
      receipts: payments.filter((p) => firstReceipt(p.receipts)).length,
      collected: payments.reduce((s, p) => s + (p.total_allocated ?? 0), 0),
      byStatus: {} as Record<string, number>,
    };
    for (const p of payments) {
      const status = p.status ?? 'initiated';
      totals.byStatus[status] = (totals.byStatus[status] ?? 0) + 1;
    }
    return totals;
  }, [payments]);

  /* ── Derived: allocation table totals ─────────────────────────────────── */

  const allocationTotals = useMemo(() => {
    const t = {
      allocated: 0,
      province: 0,
      municipality: 0,
      barangay: 0,
      sef_province: 0,
      sef_municipality: 0,
    };
    for (const a of allocations) {
      t.allocated += a.allocated_amount ?? 0;
      t.province += a.share_province ?? 0;
      t.municipality += a.share_municipality ?? 0;
      t.barangay += a.share_barangay ?? 0;
      t.sef_province += a.share_sef_province ?? 0;
      t.sef_municipality += a.share_sef_municipality ?? 0;
    }
    return t;
  }, [allocations]);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  Render                                                                     */
  /* ──────────────────────────────────────────────────────────────────────── */

  return (
    <div>
      <PageHeader
        title="Revenue Sharing & Reconciliation"
        description="Allocation of real property tax collections to provincial, municipal, and barangay shares, plus daily receipt reconciliation."
        action={
          <Button variant="outline" onClick={loadData} disabled={loading}>
            <ArrowRightLeft className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">Unable to load reconciliation data</p>
          <p className="mt-0.5 text-red-600">{error}</p>
        </div>
      )}

      {/* ── Tab navigation ───────────────────────────────────────────────── */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
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
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-700" />
        </div>
      ) : (
        <>
          {activeTab === 'summary' && (
            <SummaryView summary={sharingSummary} />
          )}
          {activeTab === 'allocations' && (
            <AllocationsView
              allocations={allocations}
              totals={allocationTotals}
            />
          )}
          {activeTab === 'reconciliation' && (
            <ReconciliationView
              daily={dailyReconciliation}
              totals={reconciliationTotals}
              paymentCount={payments.length}
            />
          )}
          {activeTab === 'remittance' && (
            <RemittanceView summary={sharingSummary} />
          )}
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Sub-views                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/** Aggregate shape passed into SummaryView / RemittanceView. */
interface SharingSummary {
  share_province: number;
  share_municipality: number;
  share_barangay: number;
  share_sef_province: number;
  share_sef_municipality: number;
  allocated: number;
  basicTotal: number;
  sefTotal: number;
  grandTotal: number;
}

/* ── 1. Revenue Sharing Summary ─────────────────────────────────────────── */

function SummaryView({ summary }: { summary: SharingSummary }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Collected Shares by Recipient
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Statutory allocation of real property tax collections. Basic RPT is
          split 35% / 40% / 25% across province, municipality, and barangay;
          SEF is split evenly between the provincial and municipal special
          education funds.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {RECIPIENTS.map((r) => {
          const Icon = r.icon;
          const value = summary[r.shareField];
          return (
            <StatCard
              key={r.key}
              label={r.name}
              value={formatCurrency(value)}
              icon={<Icon className="h-6 w-6" />}
              color={r.color}
              trend={r.description}
            />
          );
        })}
      </div>

      {/* Allocation breakdown */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">
              Basic RPT Shares
            </h3>
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">
            {formatCurrency(summary.basicTotal)}
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Quezon Province (35%)</dt>
              <dd className="font-medium text-gray-900">
                {formatCurrency(summary.share_province)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Lopez Municipality (40%)</dt>
              <dd className="font-medium text-gray-900">
                {formatCurrency(summary.share_municipality)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Barangay (25%)</dt>
              <dd className="font-medium text-gray-900">
                {formatCurrency(summary.share_barangay)}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">
              SEF Shares
            </h3>
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">
            {formatCurrency(summary.sefTotal)}
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Provincial SEF (50%)</dt>
              <dd className="font-medium text-gray-900">
                {formatCurrency(summary.share_sef_province)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Municipal SEF (50%)</dt>
              <dd className="font-medium text-gray-900">
                {formatCurrency(summary.share_sef_municipality)}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">
              Total Allocated
            </h3>
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">
            {formatCurrency(summary.allocated)}
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Sum of all payment allocations across both levy classes.
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Basic RPT component</dt>
              <dd className="font-medium text-gray-900">
                {formatCurrency(summary.basicTotal)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">SEF component</dt>
              <dd className="font-medium text-gray-900">
                {formatCurrency(summary.sefTotal)}
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 pt-2">
              <dt className="font-medium text-gray-700">Grand total shares</dt>
              <dd className="font-bold text-blue-900">
                {formatCurrency(summary.grandTotal)}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <Scale className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" />
        <p className="text-sm text-blue-800">
          Shares are computed at the point of payment allocation per{' '}
          <span className="font-medium">Presidential Decree 231</span> and the
          Local Government Code (R.A. 7160). Figures reflect the most recent{' '}
          <span className="font-medium">50</span> allocation records.
        </p>
      </div>
    </div>
  );
}

/* ── 2. Payment Allocations Table ───────────────────────────────────────── */

interface AllocationsViewProps {
  allocations: AllocationWithJoins[];
  totals: {
    allocated: number;
    province: number;
    municipality: number;
    barangay: number;
    sef_province: number;
    sef_municipality: number;
  };
}

function AllocationsView({ allocations, totals }: AllocationsViewProps) {
  if (allocations.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Banknote className="h-8 w-8" />}
          title="No Payment Allocations"
          description="Allocations are created when payments are applied to tax charges. They will appear here once collections are recorded."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Payment Allocations
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Detailed breakdown of each payment allocation and its statutory share
          destinations. Showing the {allocations.length} most recent records.
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Payment Date</th>
                <th className="px-4 py-3">Payer</th>
                <th className="px-4 py-3">Property PIN</th>
                <th className="px-4 py-3">Levy</th>
                <th className="px-4 py-3 text-right">Allocated</th>
                <th className="px-4 py-3 text-right">Province</th>
                <th className="px-4 py-3 text-right">Municipality</th>
                <th className="px-4 py-3 text-right">Barangay</th>
                <th className="px-4 py-3 text-right">SEF Prov.</th>
                <th className="px-4 py-3 text-right">SEF Mun.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {allocations.map((a) => {
                const payment = a.payment;
                const charge = a.tax_charge;
                const pin = charge?.property?.pin ?? null;
                return (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                      {payment ? formatDate(payment.payment_date) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {payment?.payer_name ?? '—'}
                      </div>
                      {payment && (
                        <div className="mt-0.5">
                          <Badge status={payment.status} />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-gray-700">
                      {pin ?? '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                      <div>{levyLabel(charge?.levy_type ?? '')}</div>
                      {charge && (
                        <div className="text-xs text-gray-400">
                          CY {charge.tax_year} · Q{charge.quarter}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                      {formatCurrency(a.allocated_amount)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">
                      {a.share_province > 0
                        ? formatCurrency(a.share_province)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">
                      {a.share_municipality > 0
                        ? formatCurrency(a.share_municipality)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">
                      {a.share_barangay > 0
                        ? formatCurrency(a.share_barangay)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">
                      {a.share_sef_province > 0
                        ? formatCurrency(a.share_sef_province)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">
                      {a.share_sef_municipality > 0
                        ? formatCurrency(a.share_sef_municipality)
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-gray-200 bg-gray-50 text-sm font-semibold text-gray-900">
              <tr>
                <td className="px-4 py-3" colSpan={4}>
                  Totals ({allocations.length} allocation
                  {allocations.length !== 1 ? 's' : ''})
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {formatCurrency(totals.allocated)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {formatCurrency(totals.province)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {formatCurrency(totals.municipality)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {formatCurrency(totals.barangay)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {formatCurrency(totals.sef_province)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {formatCurrency(totals.sef_municipality)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ── 3. Reconciliation View ─────────────────────────────────────────────── */

interface ReconciliationViewProps {
  daily: DailyReconciliation[];
  totals: {
    payments: number;
    receipts: number;
    collected: number;
    byStatus: Record<string, number>;
  };
  paymentCount: number;
}

function ReconciliationView({
  daily,
  totals,
  paymentCount,
}: ReconciliationViewProps) {
  if (paymentCount === 0) {
    return (
      <Card>
        <EmptyState
          icon={<ArrowRightLeft className="h-8 w-8" />}
          title="No Payments to Reconcile"
          description="Daily receipt reconciliation will appear here once payments are recorded and receipted."
        />
      </Card>
    );
  }

  const presentStatuses = RECON_STATUS_ORDER.filter(
    (s) => (totals.byStatus[s] ?? 0) > 0
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Daily Reconciliation
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Comparison of daily receipts against the collection register. Payments
          are grouped by collection date with payment-method and status
          breakdowns. Showing the most recent {paymentCount} payments.
        </p>
      </div>

      {/* Reconciliation overview cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm font-medium text-gray-500">Total Collected</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {formatCurrency(totals.collected)}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Across {totals.payments} payment{totals.payments !== 1 ? 's' : ''}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-gray-500">Receipts Issued</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {totals.receipts}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            of {totals.payments} payments receipted
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-gray-500">Reconciliation Days</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {daily.length}
          </p>
          <p className="mt-1 text-xs text-gray-400">distinct collection dates</p>
        </Card>
      </div>

      {/* Status distribution */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-gray-900">
          Status Distribution
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {presentStatuses.map((status) => (
            <span
              key={status}
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
            >
              <Badge status={status} />
              <span className="text-gray-500">
                {totals.byStatus[status]} payment
                {totals.byStatus[status] !== 1 ? 's' : ''}
              </span>
            </span>
          ))}
        </div>
      </Card>

      {/* Daily breakdown table */}
      <Card className="overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">
            Daily Collection Register
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Payments</th>
                <th className="px-4 py-3 text-right">Receipts</th>
                <th className="px-4 py-3 text-right">Collected</th>
                <th className="px-4 py-3">Payment Methods</th>
                <th className="px-4 py-3">Status Breakdown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {daily.map((day) => {
                const methods = PAYMENT_METHODS.filter(
                  (m) => day.byMethod[m]
                );
                const statuses = RECON_STATUS_ORDER.filter(
                  (s) => (day.byStatus[s] ?? 0) > 0
                );
                return (
                  <tr
                    key={day.date}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900">
                      {formatDate(day.date)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">
                      {day.paymentCount}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">
                      {day.receiptCount}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                      {formatCurrency(day.totalCollected)}
                    </td>
                    <td className="px-4 py-3">
                      {methods.length === 0 ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <div className="space-y-1">
                          {methods.map((m) => (
                            <div
                              key={m}
                              className="text-xs text-gray-600 whitespace-nowrap"
                            >
                              <span className="font-medium text-gray-700">
                                {capitalize(m)}
                              </span>
                              <span className="text-gray-400">
                                {' '}
                                · {day.byMethod[m].count} ·{' '}
                                {formatCurrency(day.byMethod[m].amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {statuses.map((s) => (
                          <span
                            key={s}
                            className="inline-flex items-center gap-1 text-xs text-gray-600"
                          >
                            <Badge status={s} />
                            <span className="text-gray-400">
                              {day.byStatus[s]}
                            </span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-gray-200 bg-gray-50 text-sm font-semibold text-gray-900">
              <tr>
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {totals.payments}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {totals.receipts}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {formatCurrency(totals.collected)}
                </td>
                <td className="px-4 py-3" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ── 4. Remittance Tracking ─────────────────────────────────────────────── */

function RemittanceView({ summary }: { summary: SharingSummary }) {
  const rows = RECIPIENTS.map((r) => {
    const collected = summary[r.shareField];
    return {
      key: r.key,
      name: r.name,
      description: r.description,
      collected,
      remitted: 0,
      outstanding: collected,
    };
  });

  const totalCollected = rows.reduce((s, r) => s + r.collected, 0);
  const totalRemitted = rows.reduce((s, r) => s + r.remitted, 0);
  const totalOutstanding = totalCollected - totalRemitted;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Remittance Tracking
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Outstanding balances due to each share recipient. Remittance records
          are tracked manually in this version — collected shares are aggregated
          from payment allocations.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
        <Banknote className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-600" />
        <p className="text-sm text-yellow-800">
          <span className="font-medium">Manual tracking mode.</span> Remittance
          of collected shares to each LGU is recorded outside this system. The
          figures below reflect collected shares only; remitted amounts will be
          populated once a remittance ledger is introduced.
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Share Basis</th>
                <th className="px-4 py-3 text-right">Collected</th>
                <th className="px-4 py-3 text-right">Remitted</th>
                <th className="px-4 py-3 text-right">Outstanding</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{r.name}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{r.description}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                    {formatCurrency(r.collected)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">
                    {formatCurrency(r.remitted)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-orange-700 whitespace-nowrap">
                    {formatCurrency(r.outstanding)}
                  </td>
                  <td className="px-4 py-3">
                    {r.outstanding > 0 ? (
                      <Badge status="pending" label="Pending remittance" />
                    ) : (
                      <Badge status="reconciled" label="Fully remitted" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-gray-200 bg-gray-50 text-sm font-semibold text-gray-900">
              <tr>
                <td className="px-4 py-3" colSpan={2}>
                  Total
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {formatCurrency(totalCollected)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {formatCurrency(totalRemitted)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap text-orange-700">
                  {formatCurrency(totalOutstanding)}
                </td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm font-medium text-gray-500">Total Collected</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {formatCurrency(totalCollected)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-gray-500">Total Remitted</p>
          <p className="mt-1 text-2xl font-bold text-green-700">
            {formatCurrency(totalRemitted)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-gray-500">Total Outstanding</p>
          <p className="mt-1 text-2xl font-bold text-orange-700">
            {formatCurrency(totalOutstanding)}
          </p>
        </Card>
      </div>
    </div>
  );
}
