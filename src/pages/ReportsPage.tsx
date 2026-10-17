import { useState, useEffect, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, Badge, Button, Select, EmptyState, PageHeader, StatCard } from '@/components/ui';
import { formatCurrency, formatDate, capitalize } from '@/lib/utils';
import { FileText, Download, BarChart3, TrendingUp, Building2, HandCoins, Calculator } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

type ReportType =
  | 'collection_efficiency'
  | 'arrears_recovery'
  | 'daily_collection'
  | 'barangay_share'
  | 'sef_share'
  | 'assessment_roll'
  | 'revenue_summary';

interface QuarterlyBreakdown {
  quarter: number;
  billed: number;
  collected: number;
}

interface LevyBreakdown {
  levyType: string;
  billed: number;
  collected: number;
}

interface CollectionEfficiencyData {
  totalBilled: number;
  totalCollected: number;
  efficiency: number;
  byQuarter: QuarterlyBreakdown[];
  byLevyType: LevyBreakdown[];
}

interface ArrearsYearBreakdown {
  taxYear: number;
  opening: number;
  collected: number;
  outstanding: number;
  recoveryRate: number;
}

interface ArrearsRecoveryData {
  totalOpening: number;
  totalCollected: number;
  totalOutstanding: number;
  recoveryRate: number;
  byYear: ArrearsYearBreakdown[];
}

interface DailyCollectionEntry {
  date: string;
  totalCollected: number;
  receiptCount: number;
  firstReceipt: string;
  lastReceipt: string;
  methods: { method: string; count: number; amount: number }[];
}

interface DailyCollectionData {
  days: DailyCollectionEntry[];
  totalCollected: number;
  totalReceipts: number;
}

interface BarangayShareEntry {
  id: string;
  name: string;
  code: string;
  totalShare: number;
}

interface BarangayShareData {
  byBarangay: BarangayShareEntry[];
  totalShare: number;
}

interface SefShareData {
  provinceShare: number;
  municipalityShare: number;
  totalShare: number;
}

interface ClassificationBreakdown {
  classification: string;
  count: number;
  marketValue: number;
  assessedValue: number;
  exemptCount: number;
}

interface AssessmentRollData {
  byClassification: ClassificationBreakdown[];
  totalCount: number;
  totalMarketValue: number;
  totalAssessedValue: number;
  totalExempt: number;
}

interface RevenueSummaryData {
  byLevyType: { levyType: string; currentYear: number; previousYear: number }[];
  byRecipient: { recipient: string; currentYear: number; previousYear: number }[];
  currentYearTotal: number;
  previousYearTotal: number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Constants                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

const CURRENT_YEAR = new Date().getFullYear();

const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 2019 }, (_, i) => ({
  value: String(CURRENT_YEAR - i),
  label: String(CURRENT_YEAR - i),
}));

const REPORT_TYPES: {
  key: ReportType;
  label: string;
  title: string;
  icon: ReactNode;
  description: string;
}[] = [
  {
    key: 'collection_efficiency',
    label: 'Collection Efficiency',
    title: 'Collection Efficiency Report',
    icon: <BarChart3 className="h-4 w-4" />,
    description:
      'Current-year collection performance measured against total billed amounts, broken down by quarter and levy type.',
  },
  {
    key: 'arrears_recovery',
    label: 'Arrears Recovery',
    title: 'Arrears Recovery Report',
    icon: <TrendingUp className="h-4 w-4" />,
    description:
      'Recovery of outstanding balances from prior billing periods, with year-by-year breakdown and recovery rate.',
  },
  {
    key: 'daily_collection',
    label: 'Daily Collection Register',
    title: 'Daily Collection Register',
    icon: <HandCoins className="h-4 w-4" />,
    description:
      'Day-by-day collection summary with receipt sequences, totals, and payment method breakdowns.',
  },
  {
    key: 'barangay_share',
    label: 'Barangay Share Schedule',
    title: 'Barangay Share Schedule',
    icon: <Building2 className="h-4 w-4" />,
    description:
      'Statutory 25% barangay share of Basic RPT collections, grouped by barangay jurisdiction.',
  },
  {
    key: 'sef_share',
    label: 'SEF Share Schedule',
    title: 'SEF Share Schedule',
    icon: <Calculator className="h-4 w-4" />,
    description:
      'Special Education Fund (SEF) tax collections split 50/50 between province and municipality.',
  },
  {
    key: 'assessment_roll',
    label: 'Assessment Roll Summary',
    title: 'Assessment Roll Summary',
    icon: <FileText className="h-4 w-4" />,
    description:
      'Summary of approved assessments by property classification, with market and assessed values.',
  },
  {
    key: 'revenue_summary',
    label: 'Revenue Summary',
    title: 'Revenue Summary',
    icon: <BarChart3 className="h-4 w-4" />,
    description:
      'Consolidated revenue report by levy type and recipient, with year-over-year comparison.',
  },
];

const QUARTER_LABELS: Record<number, string> = {
  1: 'Q1 — January to March',
  2: 'Q2 — April to June',
  3: 'Q3 — July to September',
  4: 'Q4 — October to December',
};

const VALID_PAYMENT_STATUSES = ['confirmed', 'receipted', 'settled', 'reconciled'];

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function levyLabel(code: string): string {
  const labels: Record<string, string> = {
    basic: 'Basic RPT',
    sef: 'SEF Tax',
    idle_land: 'Idle Land Tax',
    special_levy: 'Special Levy',
  };
  return labels[code] ?? capitalize(code);
}

function methodLabel(code: string): string {
  const labels: Record<string, string> = {
    cash: 'Cash',
    check: 'Check',
    bank_transfer: 'Bank Transfer',
    online: 'Online',
  };
  return labels[code] ?? capitalize(code);
}

function toDateKey(dateStr: string): string {
  return dateStr.split('T')[0];
}

function efficiencyPct(billed: number, collected: number): number {
  return billed > 0 ? (collected / billed) * 100 : 0;
}

function formatChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? 'New' : '—';
  const change = ((current - previous) / previous) * 100;
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
}

function changeColor(current: number, previous: number): string {
  if (previous === 0) return 'text-gray-500';
  return current >= previous ? 'text-green-600' : 'text-red-600';
}

function downloadReport(title: string, format: 'csv' | 'xls') {
  const content = document.getElementById('active-report-content');
  if (!content) return;

  const tables = Array.from(content.querySelectorAll('table'));
  const tableRows = tables.map((table) =>
    Array.from(table.querySelectorAll('tr')).map((row) =>
      Array.from(row.querySelectorAll('th, td')).map((cell) => cell.textContent?.trim() ?? '')
    )
  );
  const safeTitle = title.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  let blob: Blob;
  let filename: string;

  if (format === 'csv') {
    const csvRows: string[][] = [[title], [`Generated on ${formatDate(new Date())}`], []];
    tableRows.forEach((rows, index) => {
      if (index > 0) csvRows.push([]);
      csvRows.push(...rows);
    });
    const csv = csvRows
      .map((row) => row.map((value) => {
        const safeValue = /^[=+@\-]/.test(value) ? `'${value}` : value;
        return `"${safeValue.replace(/"/g, '""')}"`;
      }).join(','))
      .join('\r\n');
    blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
    filename = `${safeTitle}.csv`;
  } else {
    const escapeHtml = (value: string) => value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const workbookTables = tableRows.map((rows) =>
      `<table border="1">${rows.map((row, rowIndex) => `<tr>${row.map((value) => {
        const tag = rowIndex === 0 ? 'th' : 'td';
        return `<${tag}>${escapeHtml(value)}</${tag}>`;
      }).join('')}</tr>`).join('')}</table>`
    ).join('<br/>');
    const html = `<html><head><meta charset="utf-8"></head><body><h1>${escapeHtml(title)}</h1><p>Generated on ${escapeHtml(formatDate(new Date()))}</p>${workbookTables}</body></html>`;
    blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    filename = `${safeTitle}.xls`;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Shared UI components                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

function ReportHeader({ title, description }: { title: string; description: string }) {
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      </div>
      <div className="relative flex-shrink-0">
        <Button
          variant="outline"
          size="sm"
          aria-expanded={exportMenuOpen}
          onClick={() => setExportMenuOpen((open) => !open)}
        >
          <Download className="h-4 w-4" />
          Print / Export
        </Button>
        {exportMenuOpen && (
          <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            <button className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50" onClick={() => { setExportMenuOpen(false); window.print(); }}>
              Print / Save as PDF
            </button>
            <button className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50" onClick={() => { downloadReport(title, 'xls'); setExportMenuOpen(false); }}>
              Export Excel (.xls)
            </button>
            <button className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50" onClick={() => { downloadReport(title, 'csv'); setExportMenuOpen(false); }}>
              Export CSV (.csv)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-700" />
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  return (
    <Card className="p-6">
      <p className="text-sm text-red-600">{error}</p>
    </Card>
  );
}

function NoDataState() {
  return (
    <EmptyState
      icon={<FileText className="h-6 w-6" />}
      title="No data available"
      description="There is no data to display for the selected year."
    />
  );
}

function ReportFooter() {
  return (
    <p className="mt-4 text-xs text-gray-400">
      Generated on {formatDate(new Date())} · Real Property Tax System
    </p>
  );
}

/* Table class helpers */
const thLeft = 'px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const thRight = 'px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdLeft = 'px-4 py-3 text-sm text-gray-900';
const tdRight = 'px-4 py-3 text-sm text-gray-900 text-right tabular-nums font-medium';
const tdBold = 'px-4 py-3 text-sm text-gray-900 font-semibold';
const tdBoldRight = 'px-4 py-3 text-sm text-gray-900 text-right tabular-nums font-semibold';
const totalsRow = 'border-t-2 border-gray-300 bg-gray-50';

/* ────────────────────────────────────────────────────────────────────────── */
/*  1. Collection Efficiency Report                                             */
/* ────────────────────────────────────────────────────────────────────────── */

function CollectionEfficiencyReport({ year }: { year: number }) {
  const [data, setData] = useState<CollectionEfficiencyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const { data: charges, error: err } = await supabase
        .from('tax_charges')
        .select('gross_amount, paid_amount, quarter, levy_type')
        .eq('tax_year', year)
        .neq('status', 'cancelled');

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      const rows = (charges ?? []) as {
        gross_amount: number;
        paid_amount: number;
        quarter: number;
        levy_type: string;
      }[];

      const totalBilled = rows.reduce((s, r) => s + (r.gross_amount || 0), 0);
      const totalCollected = rows.reduce((s, r) => s + (r.paid_amount || 0), 0);

      const quarterMap = new Map<number, { billed: number; collected: number }>();
      for (const r of rows) {
        const entry = quarterMap.get(r.quarter) ?? { billed: 0, collected: 0 };
        entry.billed += r.gross_amount || 0;
        entry.collected += r.paid_amount || 0;
        quarterMap.set(r.quarter, entry);
      }
      const byQuarter: QuarterlyBreakdown[] = [1, 2, 3, 4].map((q) => ({
        quarter: q,
        billed: quarterMap.get(q)?.billed ?? 0,
        collected: quarterMap.get(q)?.collected ?? 0,
      }));

      const levyMap = new Map<string, { billed: number; collected: number }>();
      for (const r of rows) {
        const entry = levyMap.get(r.levy_type) ?? { billed: 0, collected: 0 };
        entry.billed += r.gross_amount || 0;
        entry.collected += r.paid_amount || 0;
        levyMap.set(r.levy_type, entry);
      }
      const byLevyType: LevyBreakdown[] = Array.from(levyMap.entries())
        .map(([levyType, v]) => ({ levyType, billed: v.billed, collected: v.collected }))
        .sort((a, b) => b.billed - a.billed);

      setData({ totalBilled, totalCollected, efficiency: efficiencyPct(totalBilled, totalCollected), byQuarter, byLevyType });
      setLoading(false);
    }
    load();
  }, [year]);

  const meta = REPORT_TYPES[0];

  if (loading) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <LoadingState />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <ErrorState error={error} />
      </div>
    );
  }
  if (!data || data.totalBilled === 0) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <NoDataState />
      </div>
    );
  }

  const effBadgeStatus = data.efficiency >= 80 ? 'paid' : data.efficiency >= 50 ? 'partially_paid' : 'overdue';

  return (
    <div>
      <ReportHeader title={meta.title} description={meta.description} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={`Billed — CY ${year}`}
          value={formatCurrency(data.totalBilled)}
          icon={<Calculator className="h-6 w-6" />}
          color="blue"
        />
        <StatCard
          label={`Collected — CY ${year}`}
          value={formatCurrency(data.totalCollected)}
          icon={<HandCoins className="h-6 w-6" />}
          color="green"
        />
        <StatCard
          label="Collection Efficiency"
          value={`${data.efficiency.toFixed(1)}%`}
          icon={<BarChart3 className="h-6 w-6" />}
          color={data.efficiency >= 80 ? 'green' : data.efficiency >= 50 ? 'yellow' : 'red'}
          trend={<Badge status={effBadgeStatus} label={`${data.efficiency.toFixed(1)}% efficiency`} />}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-4">
            <h3 className="text-sm font-semibold text-gray-900">Quarterly Breakdown</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className={thLeft}>Quarter</th>
                  <th className={thRight}>Billed</th>
                  <th className={thRight}>Collected</th>
                  <th className={thRight}>Efficiency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.byQuarter.map((q) => (
                  <tr key={q.quarter} className="hover:bg-gray-50">
                    <td className={tdLeft}>{QUARTER_LABELS[q.quarter]}</td>
                    <td className={tdRight}>{formatCurrency(q.billed)}</td>
                    <td className={tdRight}>{formatCurrency(q.collected)}</td>
                    <td className={tdRight}>{efficiencyPct(q.billed, q.collected).toFixed(1)}%</td>
                  </tr>
                ))}
                <tr className={totalsRow}>
                  <td className={tdBold}>Total</td>
                  <td className={tdBoldRight}>{formatCurrency(data.totalBilled)}</td>
                  <td className={tdBoldRight}>{formatCurrency(data.totalCollected)}</td>
                  <td className={tdBoldRight}>{data.efficiency.toFixed(1)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-4">
            <h3 className="text-sm font-semibold text-gray-900">By Levy Type</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className={thLeft}>Levy Type</th>
                  <th className={thRight}>Billed</th>
                  <th className={thRight}>Collected</th>
                  <th className={thRight}>Efficiency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.byLevyType.map((l) => (
                  <tr key={l.levyType} className="hover:bg-gray-50">
                    <td className={tdLeft}>{levyLabel(l.levyType)}</td>
                    <td className={tdRight}>{formatCurrency(l.billed)}</td>
                    <td className={tdRight}>{formatCurrency(l.collected)}</td>
                    <td className={tdRight}>{efficiencyPct(l.billed, l.collected).toFixed(1)}%</td>
                  </tr>
                ))}
                <tr className={totalsRow}>
                  <td className={tdBold}>Total</td>
                  <td className={tdBoldRight}>{formatCurrency(data.totalBilled)}</td>
                  <td className={tdBoldRight}>{formatCurrency(data.totalCollected)}</td>
                  <td className={tdBoldRight}>{data.efficiency.toFixed(1)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <ReportFooter />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  2. Arrears Recovery Report                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function ArrearsRecoveryReport({ year }: { year: number }) {
  const [data, setData] = useState<ArrearsRecoveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const { data: charges, error: err } = await supabase
        .from('tax_charges')
        .select('balance, paid_amount, tax_year, due_date')
        .lt('due_date', `${year}-01-01`)
        .neq('status', 'cancelled');

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      const rows = (charges ?? []) as {
        balance: number;
        paid_amount: number;
        tax_year: number;
        due_date: string;
      }[];

      const yearMap = new Map<number, { opening: number; collected: number; outstanding: number }>();
      for (const r of rows) {
        const entry = yearMap.get(r.tax_year) ?? { opening: 0, collected: 0, outstanding: 0 };
        entry.opening += (r.balance || 0) + (r.paid_amount || 0);
        entry.collected += r.paid_amount || 0;
        entry.outstanding += r.balance || 0;
        yearMap.set(r.tax_year, entry);
      }

      const byYear: ArrearsYearBreakdown[] = Array.from(yearMap.entries())
        .map(([taxYear, v]) => ({
          taxYear,
          opening: v.opening,
          collected: v.collected,
          outstanding: v.outstanding,
          recoveryRate: v.opening > 0 ? (v.collected / v.opening) * 100 : 0,
        }))
        .sort((a, b) => b.taxYear - a.taxYear);

      const totalOpening = byYear.reduce((s, r) => s + r.opening, 0);
      const totalCollected = byYear.reduce((s, r) => s + r.collected, 0);
      const totalOutstanding = byYear.reduce((s, r) => s + r.outstanding, 0);

      setData({
        totalOpening,
        totalCollected,
        totalOutstanding,
        recoveryRate: totalOpening > 0 ? (totalCollected / totalOpening) * 100 : 0,
        byYear,
      });
      setLoading(false);
    }
    load();
  }, [year]);

  const meta = REPORT_TYPES[1];

  if (loading) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <LoadingState />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <ErrorState error={error} />
      </div>
    );
  }
  if (!data || data.totalOpening === 0) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <NoDataState />
      </div>
    );
  }

  return (
    <div>
      <ReportHeader title={meta.title} description={meta.description} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Opening Arrears"
          value={formatCurrency(data.totalOpening)}
          icon={<Calculator className="h-6 w-6" />}
          color="blue"
        />
        <StatCard
          label="Arrears Collected"
          value={formatCurrency(data.totalCollected)}
          icon={<HandCoins className="h-6 w-6" />}
          color="green"
        />
        <StatCard
          label="Outstanding Balance"
          value={formatCurrency(data.totalOutstanding)}
          icon={<TrendingUp className="h-6 w-6" />}
          color="red"
        />
        <StatCard
          label="Recovery Rate"
          value={`${data.recoveryRate.toFixed(2)}%`}
          icon={<BarChart3 className="h-6 w-6" />}
          color={data.recoveryRate >= 50 ? 'green' : 'yellow'}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">
            Breakdown by Tax Year — Charges due before {year}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className={thLeft}>Tax Year</th>
                <th className={thRight}>Opening Arrears</th>
                <th className={thRight}>Collected</th>
                <th className={thRight}>Outstanding</th>
                <th className={thRight}>Recovery Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.byYear.map((r) => (
                <tr key={r.taxYear} className="hover:bg-gray-50">
                  <td className={tdLeft}>{r.taxYear}</td>
                  <td className={tdRight}>{formatCurrency(r.opening)}</td>
                  <td className={tdRight}>{formatCurrency(r.collected)}</td>
                  <td className={tdRight}>{formatCurrency(r.outstanding)}</td>
                  <td className={tdRight}>{r.recoveryRate.toFixed(2)}%</td>
                </tr>
              ))}
              <tr className={totalsRow}>
                <td className={tdBold}>Total</td>
                <td className={tdBoldRight}>{formatCurrency(data.totalOpening)}</td>
                <td className={tdBoldRight}>{formatCurrency(data.totalCollected)}</td>
                <td className={tdBoldRight}>{formatCurrency(data.totalOutstanding)}</td>
                <td className={tdBoldRight}>{data.recoveryRate.toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <ReportFooter />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  3. Daily Collection Register                                                */
/* ────────────────────────────────────────────────────────────────────────── */

function DailyCollectionReport({ year }: { year: number }) {
  const [data, setData] = useState<DailyCollectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const { data: payments, error: err } = await supabase
        .from('payments')
        .select('id, payment_date, payment_method, total_allocated, receipt:receipts(receipt_number)')
        .gte('payment_date', `${year}-01-01`)
        .lt('payment_date', `${year + 1}-01-01`)
        .in('status', VALID_PAYMENT_STATUSES)
        .order('payment_date', { ascending: true });

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      const rows = (payments ?? []) as Record<string, unknown>[];
      const dayMap = new Map<string, DailyCollectionEntry>();

      for (const p of rows) {
        const dateKey = toDateKey(p.payment_date as string);
        const method = p.payment_method as string;
        const allocated = (p.total_allocated as number) || 0;
        const receiptRaw = p.receipt;
        const receipt = Array.isArray(receiptRaw) ? receiptRaw[0] : receiptRaw;
        const receiptNumber = (receipt as { receipt_number?: string } | null)?.receipt_number;

        let entry = dayMap.get(dateKey);
        if (!entry) {
          entry = {
            date: dateKey,
            totalCollected: 0,
            receiptCount: 0,
            firstReceipt: '',
            lastReceipt: '',
            methods: [],
          };
          dayMap.set(dateKey, entry);
        }

        entry.totalCollected += allocated;
        if (receiptNumber) entry.receiptCount += 1;

        let methodEntry = entry.methods.find((m) => m.method === method);
        if (!methodEntry) {
          methodEntry = { method, count: 0, amount: 0 };
          entry.methods.push(methodEntry);
        }
        methodEntry.count += 1;
        methodEntry.amount += allocated;
      }

      const days = Array.from(dayMap.values()).sort((a, b) => b.date.localeCompare(a.date));

      for (const d of days) {
        const receiptNumbers = rows
          .filter((p) => toDateKey(p.payment_date as string) === d.date)
          .map((p) => {
            const r = p.receipt;
            const receipt = Array.isArray(r) ? r[0] : r;
            return (receipt as { receipt_number?: string } | null)?.receipt_number;
          })
          .filter((n): n is string => !!n)
          .sort();
        d.firstReceipt = receiptNumbers[0] ?? '—';
        d.lastReceipt = receiptNumbers[receiptNumbers.length - 1] ?? '—';
      }

      const totalCollected = days.reduce((s, d) => s + d.totalCollected, 0);
      const totalReceipts = days.reduce((s, d) => s + d.receiptCount, 0);

      setData({ days, totalCollected, totalReceipts });
      setLoading(false);
    }
    load();
  }, [year]);

  const meta = REPORT_TYPES[2];

  if (loading) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <LoadingState />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <ErrorState error={error} />
      </div>
    );
  }
  if (!data || data.days.length === 0) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <NoDataState />
      </div>
    );
  }

  return (
    <div>
      <ReportHeader title={meta.title} description={meta.description} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={`Total Collected — CY ${year}`}
          value={formatCurrency(data.totalCollected)}
          icon={<HandCoins className="h-6 w-6" />}
          color="green"
        />
        <StatCard
          label="Total Receipts Issued"
          value={String(data.totalReceipts)}
          icon={<FileText className="h-6 w-6" />}
          color="blue"
        />
        <StatCard
          label="Active Collection Days"
          value={String(data.days.length)}
          icon={<BarChart3 className="h-6 w-6" />}
          color="teal"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">Daily Collection Detail</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className={thLeft}>Date</th>
                <th className={thRight}>Total Collected</th>
                <th className={thRight}>Receipts</th>
                <th className={thLeft}>Receipt Range</th>
                <th className={thLeft}>Payment Methods</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.days.map((d) => (
                <tr key={d.date} className="hover:bg-gray-50">
                  <td className={tdLeft}>{formatDate(d.date)}</td>
                  <td className={tdRight}>{formatCurrency(d.totalCollected)}</td>
                  <td className={tdRight}>{d.receiptCount}</td>
                  <td className={`${tdLeft} text-xs text-gray-600`}>
                    <span className="font-mono">{d.firstReceipt}</span>
                    {d.firstReceipt !== d.lastReceipt && (
                      <>
                        <span className="mx-1 text-gray-400">→</span>
                        <span className="font-mono">{d.lastReceipt}</span>
                      </>
                    )}
                  </td>
                  <td className={tdLeft}>
                    <div className="flex flex-wrap gap-1">
                      {d.methods
                        .sort((a, b) => b.amount - a.amount)
                        .map((m) => (
                          <span
                            key={m.method}
                            className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                          >
                            {methodLabel(m.method)}:{' '}
                            <span className="ml-1 font-medium">{formatCurrency(m.amount)}</span>
                            <span className="ml-1 text-gray-400">({m.count})</span>
                          </span>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
              <tr className={totalsRow}>
                <td className={tdBold}>Total</td>
                <td className={tdBoldRight}>{formatCurrency(data.totalCollected)}</td>
                <td className={tdBoldRight}>{data.totalReceipts}</td>
                <td className={tdBold} colSpan={2}>{data.days.length} active collection days</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <ReportFooter />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  4. Barangay Share Schedule                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function BarangayShareReport({ year }: { year: number }) {
  const [data, setData] = useState<BarangayShareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const { data: payments, error: err } = await supabase
        .from('payments')
        .select(
          `id,
           allocations:payment_allocations(
             share_barangay,
             tax_charge:tax_charges(
               property:properties(
                 barangay:jurisdictions!barangay_id(id, name, code)
               )
             )
           )`
        )
        .gte('payment_date', `${year}-01-01`)
        .lt('payment_date', `${year + 1}-01-01`)
        .in('status', VALID_PAYMENT_STATUSES);

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      const rows = (payments ?? []) as Record<string, unknown>[];
      const barangayMap = new Map<string, BarangayShareEntry>();

      for (const p of rows) {
        const allocations = (p.allocations as Record<string, unknown>[]) ?? [];
        for (const a of allocations) {
          const share = (a.share_barangay as number) || 0;
          if (share === 0) continue;
          const taxCharge = a.tax_charge as Record<string, unknown> | null;
          const property = taxCharge?.property as Record<string, unknown> | null;
          const barangay = property?.barangay as { id: string; name: string; code: string } | null;

          const key = barangay?.id ?? 'unknown';
          const existing = barangayMap.get(key);
          if (existing) {
            existing.totalShare += share;
          } else {
            barangayMap.set(key, {
              id: key,
              name: barangay?.name ?? 'Unassigned',
              code: barangay?.code ?? '—',
              totalShare: share,
            });
          }
        }
      }

      const byBarangay = Array.from(barangayMap.values()).sort((a, b) => b.totalShare - a.totalShare);
      const totalShare = byBarangay.reduce((s, b) => s + b.totalShare, 0);

      setData({ byBarangay, totalShare });
      setLoading(false);
    }
    load();
  }, [year]);

  const meta = REPORT_TYPES[3];

  if (loading) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <LoadingState />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <ErrorState error={error} />
      </div>
    );
  }
  if (!data || data.byBarangay.length === 0) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <NoDataState />
      </div>
    );
  }

  return (
    <div>
      <ReportHeader title={meta.title} description={meta.description} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={`Total Barangay Share — CY ${year}`}
          value={formatCurrency(data.totalShare)}
          icon={<HandCoins className="h-6 w-6" />}
          color="green"
        />
        <StatCard
          label="Number of Barangays"
          value={String(data.byBarangay.length)}
          icon={<Building2 className="h-6 w-6" />}
          color="blue"
        />
        <StatCard
          label="Average Share per Barangay"
          value={formatCurrency(data.totalShare / data.byBarangay.length)}
          icon={<Calculator className="h-6 w-6" />}
          color="teal"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">
            Statutory 25% Barangay Share — By Jurisdiction
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className={thLeft}>Barangay</th>
                <th className={thLeft}>Code</th>
                <th className={thRight}>Total Share Collected</th>
                <th className={thRight}>% of Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.byBarangay.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className={tdLeft}>{b.name}</td>
                  <td className={`${tdLeft} font-mono text-xs text-gray-600`}>{b.code}</td>
                  <td className={tdRight}>{formatCurrency(b.totalShare)}</td>
                  <td className={tdRight}>
                    {data.totalShare > 0 ? ((b.totalShare / data.totalShare) * 100).toFixed(1) : '0.0'}%
                  </td>
                </tr>
              ))}
              <tr className={totalsRow}>
                <td className={tdBold} colSpan={2}>Total</td>
                <td className={tdBoldRight}>{formatCurrency(data.totalShare)}</td>
                <td className={tdBoldRight}>100.0%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <ReportFooter />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  5. SEF Share Schedule                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

function SefShareReport({ year }: { year: number }) {
  const [data, setData] = useState<SefShareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const { data: payments, error: err } = await supabase
        .from('payments')
        .select(
          `id,
           allocations:payment_allocations(
             share_sef_province, share_sef_municipality
           )`
        )
        .gte('payment_date', `${year}-01-01`)
        .lt('payment_date', `${year + 1}-01-01`)
        .in('status', VALID_PAYMENT_STATUSES);

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      const rows = (payments ?? []) as Record<string, unknown>[];
      let provinceShare = 0;
      let municipalityShare = 0;

      for (const p of rows) {
        const allocations = (p.allocations as Record<string, unknown>[]) ?? [];
        for (const a of allocations) {
          provinceShare += (a.share_sef_province as number) || 0;
          municipalityShare += (a.share_sef_municipality as number) || 0;
        }
      }

      setData({
        provinceShare,
        municipalityShare,
        totalShare: provinceShare + municipalityShare,
      });
      setLoading(false);
    }
    load();
  }, [year]);

  const meta = REPORT_TYPES[4];

  if (loading) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <LoadingState />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <ErrorState error={error} />
      </div>
    );
  }
  if (!data || data.totalShare === 0) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <NoDataState />
      </div>
    );
  }

  const provincePct = data.totalShare > 0 ? (data.provinceShare / data.totalShare) * 100 : 0;
  const municipalityPct = data.totalShare > 0 ? (data.municipalityShare / data.totalShare) * 100 : 0;

  return (
    <div>
      <ReportHeader title={meta.title} description={meta.description} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Province Share (50%)"
          value={formatCurrency(data.provinceShare)}
          icon={<Building2 className="h-6 w-6" />}
          color="blue"
        />
        <StatCard
          label="Municipality Share (50%)"
          value={formatCurrency(data.municipalityShare)}
          icon={<Calculator className="h-6 w-6" />}
          color="teal"
        />
        <StatCard
          label={`Total SEF Collection — CY ${year}`}
          value={formatCurrency(data.totalShare)}
          icon={<HandCoins className="h-6 w-6" />}
          color="green"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">
            SEF 50/50 Statutory Split — Province vs Municipality
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className={thLeft}>Recipient</th>
                <th className={thRight}>Amount</th>
                <th className={thRight}>Share</th>
                <th className={thLeft}>Statutory Basis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr className="hover:bg-gray-50">
                <td className={tdLeft}>
                  <div className="font-medium">Province — SEF</div>
                  <div className="text-xs text-gray-500">Quezon Province</div>
                </td>
                <td className={tdRight}>{formatCurrency(data.provinceShare)}</td>
                <td className={tdRight}>{provincePct.toFixed(1)}%</td>
                <td className={`${tdLeft} text-xs text-gray-600`}>50% of SEF collection (LGC Art. 272)</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className={tdLeft}>
                  <div className="font-medium">Municipality — SEF</div>
                  <div className="text-xs text-gray-500">Municipality of Lopez</div>
                </td>
                <td className={tdRight}>{formatCurrency(data.municipalityShare)}</td>
                <td className={tdRight}>{municipalityPct.toFixed(1)}%</td>
                <td className={`${tdLeft} text-xs text-gray-600`}>50% of SEF collection (LGC Art. 272)</td>
              </tr>
              <tr className={totalsRow}>
                <td className={tdBold}>Total SEF Collection</td>
                <td className={tdBoldRight}>{formatCurrency(data.totalShare)}</td>
                <td className={tdBoldRight}>100.0%</td>
                <td className={tdBold}>Special Education Fund</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <ReportFooter />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  6. Assessment Roll Summary                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function AssessmentRollReport({ year }: { year: number }) {
  const [data, setData] = useState<AssessmentRollData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const { data: assessments, error: err } = await supabase
        .from('assessments')
        .select(
          `classification, market_value, assessed_value,
           property_unit:property_units(is_exempt, classification)`
        )
        .eq('status', 'approved')
        .lte('effective_date', `${year}-12-31`);

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      const rows = (assessments ?? []) as Record<string, unknown>[];
      const classMap = new Map<string, ClassificationBreakdown>();

      for (const a of rows) {
        const classification = (a.classification as string) || 'residential';
        const marketValue = (a.market_value as number) || 0;
        const assessedValue = (a.assessed_value as number) || 0;
        const unit = a.property_unit as { is_exempt?: boolean; classification?: string } | null;
        const isExempt = unit?.is_exempt ?? false;

        let entry = classMap.get(classification);
        if (!entry) {
          entry = {
            classification,
            count: 0,
            marketValue: 0,
            assessedValue: 0,
            exemptCount: 0,
          };
          classMap.set(classification, entry);
        }
        entry.count += 1;
        entry.marketValue += marketValue;
        entry.assessedValue += assessedValue;
        if (isExempt) entry.exemptCount += 1;
      }

      const byClassification = Array.from(classMap.values()).sort((a, b) => b.count - a.count);
      const totalCount = byClassification.reduce((s, c) => s + c.count, 0);
      const totalMarketValue = byClassification.reduce((s, c) => s + c.marketValue, 0);
      const totalAssessedValue = byClassification.reduce((s, c) => s + c.assessedValue, 0);
      const totalExempt = byClassification.reduce((s, c) => s + c.exemptCount, 0);

      setData({ byClassification, totalCount, totalMarketValue, totalAssessedValue, totalExempt });
      setLoading(false);
    }
    load();
  }, [year]);

  const meta = REPORT_TYPES[5];

  if (loading) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <LoadingState />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <ErrorState error={error} />
      </div>
    );
  }
  if (!data || data.totalCount === 0) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <NoDataState />
      </div>
    );
  }

  return (
    <div>
      <ReportHeader title={meta.title} description={meta.description} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Assessments"
          value={String(data.totalCount)}
          icon={<FileText className="h-6 w-6" />}
          color="blue"
        />
        <StatCard
          label="Total Market Value"
          value={formatCurrency(data.totalMarketValue)}
          icon={<Building2 className="h-6 w-6" />}
          color="teal"
        />
        <StatCard
          label="Total Assessed Value"
          value={formatCurrency(data.totalAssessedValue)}
          icon={<Calculator className="h-6 w-6" />}
          color="green"
        />
        <StatCard
          label="Exempt Properties"
          value={String(data.totalExempt)}
          icon={<FileText className="h-6 w-6" />}
          color="yellow"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">
            Assessment Roll by Classification — As of {year}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className={thLeft}>Classification</th>
                <th className={thRight}>Count</th>
                <th className={thRight}>Market Value</th>
                <th className={thRight}>Assessed Value</th>
                <th className={thRight}>Avg Assessment Level</th>
                <th className={thRight}>Exempt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.byClassification.map((c) => (
                <tr key={c.classification} className="hover:bg-gray-50">
                  <td className={tdLeft}>
                    <div className="flex items-center gap-2">
                      {capitalize(c.classification)}
                      {c.exemptCount > 0 && <Badge status="active" label={`${c.exemptCount} exempt`} />}
                    </div>
                  </td>
                  <td className={tdRight}>{c.count}</td>
                  <td className={tdRight}>{formatCurrency(c.marketValue)}</td>
                  <td className={tdRight}>{formatCurrency(c.assessedValue)}</td>
                  <td className={tdRight}>
                    {c.marketValue > 0 ? ((c.assessedValue / c.marketValue) * 100).toFixed(1) : '0.0'}%
                  </td>
                  <td className={tdRight}>{c.exemptCount}</td>
                </tr>
              ))}
              <tr className={totalsRow}>
                <td className={tdBold}>Total</td>
                <td className={tdBoldRight}>{data.totalCount}</td>
                <td className={tdBoldRight}>{formatCurrency(data.totalMarketValue)}</td>
                <td className={tdBoldRight}>{formatCurrency(data.totalAssessedValue)}</td>
                <td className={tdBoldRight}>
                  {data.totalMarketValue > 0 ? ((data.totalAssessedValue / data.totalMarketValue) * 100).toFixed(1) : '0.0'}%
                </td>
                <td className={tdBoldRight}>{data.totalExempt}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <ReportFooter />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  7. Revenue Summary                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

function RevenueSummaryReport({ year }: { year: number }) {
  const [data, setData] = useState<RevenueSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: payments, error: err } = await supabase
          .from('payments')
          .select(
            `id,
           payment_date,
           allocations:payment_allocations(
             allocated_amount,
             share_province, share_municipality, share_barangay,
             share_sef_province, share_sef_municipality,
             tax_charge:tax_charges(levy_type)
           )`
          )
          .gte('payment_date', `${year - 1}-01-01`)
          .lt('payment_date', `${year + 1}-01-01`)
          .in('status', VALID_PAYMENT_STATUSES);

        if (err) throw err;

      const rows = (payments ?? []) as Record<string, unknown>[];

      // Determine which year each payment belongs to
      const levyCurrent = new Map<string, number>();
      const levyPrevious = new Map<string, number>();
      const recipientCurrent = new Map<string, number>();
      const recipientPrevious = new Map<string, number>();

      for (const p of rows) {
        const paymentDate = p.payment_date as string;
        const paymentYear = parseInt(toDateKey(paymentDate).split('-')[0], 10);
        const isCurrent = paymentYear === year;
        const isPrevious = paymentYear === year - 1;
        if (!isCurrent && !isPrevious) continue;

        const allocations = (p.allocations as Record<string, unknown>[]) ?? [];
        for (const a of allocations) {
          const allocated = (a.allocated_amount as number) || 0;
          const taxCharge = a.tax_charge as Record<string, unknown> | null;
          const levyType = (taxCharge?.levy_type as string) ?? 'unknown';

          const shareProvince = (a.share_province as number) || 0;
          const shareMunicipality = (a.share_municipality as number) || 0;
          const shareBarangay = (a.share_barangay as number) || 0;
          const shareSefProvince = (a.share_sef_province as number) || 0;
          const shareSefMunicipality = (a.share_sef_municipality as number) || 0;

          if (isCurrent) {
            levyCurrent.set(levyType, (levyCurrent.get(levyType) ?? 0) + allocated);
            recipientCurrent.set('Province', (recipientCurrent.get('Province') ?? 0) + shareProvince);
            recipientCurrent.set('Municipality', (recipientCurrent.get('Municipality') ?? 0) + shareMunicipality);
            recipientCurrent.set('Barangay', (recipientCurrent.get('Barangay') ?? 0) + shareBarangay);
            recipientCurrent.set('SEF — Province', (recipientCurrent.get('SEF — Province') ?? 0) + shareSefProvince);
            recipientCurrent.set('SEF — Municipality', (recipientCurrent.get('SEF — Municipality') ?? 0) + shareSefMunicipality);
          } else {
            levyPrevious.set(levyType, (levyPrevious.get(levyType) ?? 0) + allocated);
            recipientPrevious.set('Province', (recipientPrevious.get('Province') ?? 0) + shareProvince);
            recipientPrevious.set('Municipality', (recipientPrevious.get('Municipality') ?? 0) + shareMunicipality);
            recipientPrevious.set('Barangay', (recipientPrevious.get('Barangay') ?? 0) + shareBarangay);
            recipientPrevious.set('SEF — Province', (recipientPrevious.get('SEF — Province') ?? 0) + shareSefProvince);
            recipientPrevious.set('SEF — Municipality', (recipientPrevious.get('SEF — Municipality') ?? 0) + shareSefMunicipality);
          }
        }
      }

      const allLevyTypes = new Set([...levyCurrent.keys(), ...levyPrevious.keys()]);
      const byLevyType = Array.from(allLevyTypes)
        .map((lt) => ({
          levyType: lt,
          currentYear: levyCurrent.get(lt) ?? 0,
          previousYear: levyPrevious.get(lt) ?? 0,
        }))
        .sort((a, b) => b.currentYear + b.previousYear - (a.currentYear + a.previousYear));

      const recipients = ['Province', 'Municipality', 'Barangay', 'SEF — Province', 'SEF — Municipality'];
      const byRecipient = recipients.map((r) => ({
        recipient: r,
        currentYear: recipientCurrent.get(r) ?? 0,
        previousYear: recipientPrevious.get(r) ?? 0,
      }));

      const currentYearTotal = byLevyType.reduce((s, l) => s + l.currentYear, 0);
      const previousYearTotal = byLevyType.reduce((s, l) => s + l.previousYear, 0);

      setData({ byLevyType, byRecipient, currentYearTotal, previousYearTotal });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load revenue summary.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [year]);

  const meta = REPORT_TYPES[6];

  if (loading) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <LoadingState />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <ErrorState error={error} />
      </div>
    );
  }
  if (!data || (data.currentYearTotal === 0 && data.previousYearTotal === 0)) {
    return (
      <div>
        <ReportHeader title={meta.title} description={meta.description} />
        <NoDataState />
      </div>
    );
  }

  return (
    <div>
      <ReportHeader title={meta.title} description={meta.description} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={`Total Revenue — CY ${year}`}
          value={formatCurrency(data.currentYearTotal)}
          icon={<HandCoins className="h-6 w-6" />}
          color="green"
        />
        <StatCard
          label={`Total Revenue — CY ${year - 1}`}
          value={formatCurrency(data.previousYearTotal)}
          icon={<Calculator className="h-6 w-6" />}
          color="blue"
        />
        <StatCard
          label="Year-over-Year Change"
          value={formatChange(data.currentYearTotal, data.previousYearTotal)}
          icon={<TrendingUp className="h-6 w-6" />}
          color={data.currentYearTotal >= data.previousYearTotal ? 'green' : 'red'}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-4">
            <h3 className="text-sm font-semibold text-gray-900">Revenue by Levy Type</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className={thLeft}>Levy Type</th>
                  <th className={thRight}>{year}</th>
                  <th className={thRight}>{year - 1}</th>
                  <th className={thRight}>Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.byLevyType.map((l) => (
                  <tr key={l.levyType} className="hover:bg-gray-50">
                    <td className={tdLeft}>{levyLabel(l.levyType)}</td>
                    <td className={tdRight}>{formatCurrency(l.currentYear)}</td>
                    <td className={tdRight}>{formatCurrency(l.previousYear)}</td>
                    <td className={`${tdRight} ${changeColor(l.currentYear, l.previousYear)}`}>
                      {formatChange(l.currentYear, l.previousYear)}
                    </td>
                  </tr>
                ))}
                <tr className={totalsRow}>
                  <td className={tdBold}>Total</td>
                  <td className={tdBoldRight}>{formatCurrency(data.currentYearTotal)}</td>
                  <td className={tdBoldRight}>{formatCurrency(data.previousYearTotal)}</td>
                  <td className={`${tdBoldRight} ${changeColor(data.currentYearTotal, data.previousYearTotal)}`}>
                    {formatChange(data.currentYearTotal, data.previousYearTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-4">
            <h3 className="text-sm font-semibold text-gray-900">Revenue Shares by Recipient</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className={thLeft}>Recipient</th>
                  <th className={thRight}>{year}</th>
                  <th className={thRight}>{year - 1}</th>
                  <th className={thRight}>Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.byRecipient.map((r) => (
                  <tr key={r.recipient} className="hover:bg-gray-50">
                    <td className={tdLeft}>{r.recipient}</td>
                    <td className={tdRight}>{formatCurrency(r.currentYear)}</td>
                    <td className={tdRight}>{formatCurrency(r.previousYear)}</td>
                    <td className={`${tdRight} ${changeColor(r.currentYear, r.previousYear)}`}>
                      {formatChange(r.currentYear, r.previousYear)}
                    </td>
                  </tr>
                ))}
                <tr className={totalsRow}>
                  <td className={tdBold}>Total</td>
                  <td className={tdBoldRight}>
                    {formatCurrency(data.byRecipient.reduce((s, r) => s + r.currentYear, 0))}
                  </td>
                  <td className={tdBoldRight}>
                    {formatCurrency(data.byRecipient.reduce((s, r) => s + r.previousYear, 0))}
                  </td>
                  <td className={tdBoldRight}>—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <ReportFooter />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Main ReportsPage component                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function ReportsPage() {
  const [activeReport, setActiveReport] = useState<ReportType>('collection_efficiency');
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Generate statutory and management reports for real property tax operations"
        action={
          <Select
            value={String(selectedYear)}
            onChange={(v) => setSelectedYear(Number(v))}
            options={YEAR_OPTIONS}
          />
        }
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Report type sidebar */}
        <div className="lg:w-64 flex-shrink-0">
          <Card className="p-2">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Report Types
            </p>
            {REPORT_TYPES.map((rt) => (
              <button
                key={rt.key}
                onClick={() => setActiveReport(rt.key)}
                className={`mb-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeReport === rt.key
                    ? 'bg-blue-700 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {rt.icon}
                {rt.label}
              </button>
            ))}
          </Card>
        </div>

        {/* Report content */}
        <div id="active-report-content" className="min-w-0 flex-1">
          {activeReport === 'collection_efficiency' && (
            <CollectionEfficiencyReport year={selectedYear} />
          )}
          {activeReport === 'arrears_recovery' && (
            <ArrearsRecoveryReport year={selectedYear} />
          )}
          {activeReport === 'daily_collection' && (
            <DailyCollectionReport year={selectedYear} />
          )}
          {activeReport === 'barangay_share' && (
            <BarangayShareReport year={selectedYear} />
          )}
          {activeReport === 'sef_share' && (
            <SefShareReport year={selectedYear} />
          )}
          {activeReport === 'assessment_roll' && (
            <AssessmentRollReport year={selectedYear} />
          )}
          {activeReport === 'revenue_summary' && (
            <RevenueSummaryReport year={selectedYear} />
          )}
        </div>
      </div>
    </div>
  );
}
