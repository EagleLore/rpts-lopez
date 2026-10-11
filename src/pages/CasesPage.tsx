import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, Badge, Button, Modal, Input, Select, TextArea, EmptyState, PageHeader } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, formatDate, generateCaseNumber, capitalize } from '@/lib/utils';
import { CASE_TYPES } from '@/lib/constants';
import { Gavel, FileWarning, Clock, CheckCircle } from 'lucide-react';
import type { Case, ComplianceCalendarEntry } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CaseWithProperty extends Omit<Case, 'property'> {
  property: { pin: string | null; tax_declaration_number: string | null } | null;
}

interface PropertyOption {
  id: string;
  pin: string | null;
  tax_declaration_number: string | null;
}

interface CreateCaseForm {
  caseType: string;
  propertyId: string;
  filedDate: string;
  noticeReceiptDate: string;
  description: string;
  amountInDispute: string;
  caseNumber: string;
}

// ─── Date helpers ──────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function addDays(dateStr: string, days: number): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function daysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const today = new Date(todayISO() + 'T00:00:00');
  const due = new Date(deadline + 'T00:00:00');
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

// ─── Label helpers ─────────────────────────────────────────────────────────────

function getCaseTypeName(code: string): string {
  return CASE_TYPES.find((t) => t.code === code)?.name || capitalize(code);
}

// ─── Workflow definitions ──────────────────────────────────────────────────────

const ACTIVE_STATUSES = ['filed', 'pending', 'under_review'];

const CASE_STATUS_FLOW: Record<string, { label: string; nextStatus: string }[]> = {
  filed: [{ label: 'Mark Pending', nextStatus: 'pending' }],
  pending: [{ label: 'Start Review', nextStatus: 'under_review' }],
  under_review: [
    { label: 'Decide', nextStatus: 'decided' },
    { label: 'Dismiss', nextStatus: 'dismissed' },
  ],
  decided: [
    { label: 'Close Case', nextStatus: 'closed' },
    { label: 'Mark Appealed', nextStatus: 'appealed' },
  ],
  dismissed: [
    { label: 'Close Case', nextStatus: 'closed' },
    { label: 'Mark Appealed', nextStatus: 'appealed' },
  ],
};

const CASE_STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'filed', label: 'Filed' },
  { value: 'pending', label: 'Pending' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'decided', label: 'Decided' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'closed', label: 'Closed' },
  { value: 'appealed', label: 'Appealed' },
];

const CASE_TYPE_FILTER_OPTIONS = [
  { value: '', label: 'All Case Types' },
  ...CASE_TYPES.map((t) => ({ value: t.code, label: t.name })),
];

const COMPLIANCE_NEXT_STATUS: Record<string, string | null> = {
  pending: 'prepared',
  prepared: 'submitted',
  submitted: 'acknowledged',
  acknowledged: null,
  overdue: 'prepared',
};

// ─── Deadline alert helpers ────────────────────────────────────────────────────

interface DeadlineAlert {
  label: string;
  deadline: string;
  days: number;
}

function getDeadlineAlerts(caseRow: CaseWithProperty): DeadlineAlert[] {
  if (!ACTIVE_STATUSES.includes(caseRow.status)) return [];
  const alerts: DeadlineAlert[] = [];
  if (caseRow.submission_deadline) {
    const d = daysUntil(caseRow.submission_deadline);
    if (d !== null && d <= 7) {
      alerts.push({ label: 'Submission Deadline', deadline: caseRow.submission_deadline, days: d });
    }
  }
  if (caseRow.decision_deadline) {
    const d = daysUntil(caseRow.decision_deadline);
    if (d !== null && d <= 7) {
      alerts.push({ label: 'Decision Deadline', deadline: caseRow.decision_deadline, days: d });
    }
  }
  return alerts;
}

function getDeadlineBoxClass(deadline: string | null): string {
  if (!deadline) return 'border-gray-200';
  const d = daysUntil(deadline);
  if (d === null) return 'border-gray-200';
  if (d < 0) return 'border-red-200 bg-red-50';
  if (d <= 7) return 'border-yellow-200 bg-yellow-50';
  return 'border-gray-200';
}

function getComplianceBorderClass(deadline: string, status: string): string {
  if (status === 'acknowledged') return 'border-gray-300 bg-gray-50';
  const d = daysUntil(deadline);
  if (d === null) return 'border-blue-200 bg-blue-50';
  if (d < 0) return 'border-red-300 bg-red-50';
  if (d <= 14) return 'border-yellow-300 bg-yellow-50';
  return 'border-blue-200 bg-blue-50';
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function CasesPage() {
  const { staffUser } = useAuth();

  // Data state
  const [cases, setCases] = useState<CaseWithProperty[]>([]);
  const [complianceEntries, setComplianceEntries] = useState<ComplianceCalendarEntry[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCaseType, setFilterCaseType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateCaseForm>({
    caseType: '',
    propertyId: '',
    filedDate: todayISO(),
    noticeReceiptDate: '',
    description: '',
    amountInDispute: '',
    caseNumber: '',
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Detail modal state
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedCase, setSelectedCase] = useState<CaseWithProperty | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [decisionText, setDecisionText] = useState('');
  const [savingDecision, setSavingDecision] = useState(false);

  // ─── Computed deadlines for create form ──────────────────────────────────────

  const computedDeadlines = useMemo(() => {
    const { caseType, filedDate, noticeReceiptDate } = createForm;
    if (caseType === 'assessment_appeal' && noticeReceiptDate) {
      return { submission: addDays(noticeReceiptDate, 60), decision: '' };
    }
    if (caseType === 'payment_protest' && filedDate) {
      return { submission: addDays(filedDate, 30), decision: addDays(filedDate, 60) };
    }
    return { submission: '', decision: '' };
  }, [createForm.caseType, createForm.filedDate, createForm.noticeReceiptDate]);

  // ─── Data loading ────────────────────────────────────────────────────────────

  async function loadCases() {
    const { data, error: err } = await supabase
      .from('cases')
      .select(`*, property:properties!property_id(pin, tax_declaration_number)`)
      .order('filed_date', { ascending: false });
    if (err) {
      setError(err.message);
    } else {
      setCases((data || []) as CaseWithProperty[]);
    }
  }

  async function loadComplianceCalendar() {
    const { data, error: err } = await supabase
      .from('compliance_calendar')
      .select('*')
      .order('deadline', { ascending: true });
    if (err) {
      console.error('Failed to load compliance calendar:', err.message);
    } else {
      setComplianceEntries((data || []) as ComplianceCalendarEntry[]);
    }
  }

  async function loadProperties() {
    const { data, error: err } = await supabase
      .from('properties')
      .select('id, pin, tax_declaration_number')
      .eq('status', 'active')
      .order('pin', { ascending: true });
    if (!err && data) {
      setProperties(data as PropertyOption[]);
    }
  }

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      await Promise.all([loadCases(), loadComplianceCalendar(), loadProperties()]);
      setLoading(false);
    }
    loadAll();
  }, []);

  // ─── Auto-generate case number when case type changes ─────────────────────────

  useEffect(() => {
    if (createForm.caseType) {
      const num = generateCaseNumber(createForm.caseType);
      setCreateForm((prev) => ({ ...prev, caseNumber: num }));
    }
  }, [createForm.caseType]);

  // ─── Filtered cases ──────────────────────────────────────────────────────────

  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      if (filterCaseType && c.case_type !== filterCaseType) return false;
      if (filterStatus && c.status !== filterStatus) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const pin = c.property?.pin?.toLowerCase() ?? '';
        const td = c.property?.tax_declaration_number?.toLowerCase() ?? '';
        if (!c.case_number.toLowerCase().includes(q) && !pin.includes(q) && !td.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [cases, filterCaseType, filterStatus, searchQuery]);

  // ─── Summary stats ───────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const active = cases.filter((c) => ACTIVE_STATUSES.includes(c.status));
    const resolved = cases.filter((c) => ['decided', 'closed'].includes(c.status));
    const upcoming = cases.filter((c) => {
      if (!ACTIVE_STATUSES.includes(c.status)) return false;
      const sd = daysUntil(c.submission_deadline);
      const dd = daysUntil(c.decision_deadline);
      return (sd !== null && sd >= 0 && sd <= 7) || (dd !== null && dd >= 0 && dd <= 7);
    });
    const totalDispute = active.reduce((sum, c) => sum + (c.amount_in_dispute ?? 0), 0);
    return {
      total: cases.length,
      pending: active.length,
      resolved: resolved.length,
      upcoming: upcoming.length,
      totalDispute,
    };
  }, [cases]);

  // ─── Create case ─────────────────────────────────────────────────────────────

  function openCreateModal() {
    setCreateForm({
      caseType: '',
      propertyId: '',
      filedDate: todayISO(),
      noticeReceiptDate: '',
      description: '',
      amountInDispute: '',
      caseNumber: '',
    });
    setCreateError(null);
    setShowCreateModal(true);
  }

  async function handleCreateCase() {
    setCreateError(null);

    if (!createForm.caseType) {
      setCreateError('Please select a case type.');
      return;
    }
    if (!createForm.propertyId) {
      setCreateError('Please select a property.');
      return;
    }
    if (!createForm.filedDate) {
      setCreateError('Please enter the filed date.');
      return;
    }
    if (createForm.caseType === 'assessment_appeal' && !createForm.noticeReceiptDate) {
      setCreateError('Notice receipt date is required for assessment appeals to compute the 60-day submission deadline.');
      return;
    }
    const amountPesos = parseFloat(createForm.amountInDispute);
    if (isNaN(amountPesos) || amountPesos <= 0) {
      setCreateError('Please enter a valid amount in dispute (must be greater than zero).');
      return;
    }
    if (!createForm.description.trim()) {
      setCreateError('Please enter a case description.');
      return;
    }

    setCreating(true);

    const amountCentavos = Math.round(amountPesos * 100);
    const caseNumber = generateCaseNumber(createForm.caseType);

    const insertData: Record<string, unknown> = {
      case_number: caseNumber,
      case_type: createForm.caseType,
      property_id: createForm.propertyId,
      filed_date: createForm.filedDate,
      description: createForm.description.trim(),
      amount_in_dispute: amountCentavos,
      status: 'filed',
    };

    if (createForm.noticeReceiptDate) {
      insertData.notice_receipt_date = createForm.noticeReceiptDate;
    }
    if (computedDeadlines.submission) {
      insertData.submission_deadline = computedDeadlines.submission;
    }
    if (computedDeadlines.decision) {
      insertData.decision_deadline = computedDeadlines.decision;
    }

    const { error: insertErr } = await supabase.from('cases').insert(insertData);

    setCreating(false);

    if (insertErr) {
      setCreateError(insertErr.message);
      return;
    }

    setShowCreateModal(false);
    await loadCases();
  }

  // ─── Case detail & workflow ──────────────────────────────────────────────────

  function openDetailModal(caseRow: CaseWithProperty) {
    setSelectedCase(caseRow);
    setDecisionText(caseRow.decision_text ?? '');
    setShowDetailModal(true);
  }

  async function handleStatusChange(nextStatus: string) {
    if (!selectedCase) return;
    setDetailLoading(true);

    const updateData: Record<string, unknown> = { status: nextStatus };

    if (nextStatus === 'decided' || nextStatus === 'dismissed') {
      updateData.decided_at = new Date().toISOString();
      updateData.decided_by = staffUser?.full_name ?? null;
      updateData.decision_text = decisionText.trim() || null;
    }

    const { data, error: updateErr } = await supabase
      .from('cases')
      .update(updateData)
      .eq('id', selectedCase.id)
      .select(`*, property:properties!property_id(pin, tax_declaration_number)`)
      .single();

    setDetailLoading(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    const updated = data as CaseWithProperty;
    setSelectedCase(updated);
    setDecisionText(updated.decision_text ?? '');
    await loadCases();
  }

  async function handleSaveDecision() {
    if (!selectedCase) return;
    setSavingDecision(true);

    const { data, error: updateErr } = await supabase
      .from('cases')
      .update({ decision_text: decisionText.trim() || null })
      .eq('id', selectedCase.id)
      .select(`*, property:properties!property_id(pin, tax_declaration_number)`)
      .single();

    setSavingDecision(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    const updated = data as CaseWithProperty;
    setSelectedCase(updated);
    await loadCases();
  }

  // ─── Compliance calendar ─────────────────────────────────────────────────────

  async function handleComplianceStatusChange(id: string, newStatus: string) {
    const { error: updateErr } = await supabase
      .from('compliance_calendar')
      .update({ status: newStatus })
      .eq('id', id);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    setComplianceEntries((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, status: newStatus as ComplianceCalendarEntry['status'] } : e,
      ),
    );
  }

  // ─── Deadline cell renderer for table ────────────────────────────────────────

  function renderDeadlineCell(deadline: string | null) {
    if (!deadline) return <span className="text-gray-400">—</span>;
    const days = daysUntil(deadline);
    if (days === null) return <span className="text-gray-400">—</span>;
    if (days < 0) {
      return (
        <div>
          <span className="font-medium text-red-600">{formatDate(deadline)}</span>
          <span className="block text-xs text-red-500">{Math.abs(days)}d overdue</span>
        </div>
      );
    }
    if (days <= 7) {
      return (
        <div>
          <span className="font-medium text-yellow-700">{formatDate(deadline)}</span>
          <span className="block text-xs text-yellow-600">{days}d left</span>
        </div>
      );
    }
    return <span className="text-gray-700">{formatDate(deadline)}</span>;
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-700" />
      </div>
    );
  }

  const deadlineAlerts = selectedCase ? getDeadlineAlerts(selectedCase) : [];

  return (
    <div>
      <PageHeader
        title="Cases & Compliance"
        description="Manage tax cases, appeals, and statutory compliance reporting"
        action={
          <Button onClick={openCreateModal}>
            <Gavel className="h-4 w-4" />
            File New Case
          </Button>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ─── Summary Stats ──────────────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Total Cases</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{stats.total}</p>
            </div>
            <div className="rounded-lg bg-orange-50 p-3 text-orange-700">
              <Gavel className="h-6 w-6" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Pending Review</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{stats.pending}</p>
            </div>
            <div className="rounded-lg bg-yellow-50 p-3 text-yellow-700">
              <Clock className="h-6 w-6" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Decided / Closed</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{stats.resolved}</p>
            </div>
            <div className="rounded-lg bg-green-50 p-3 text-green-700">
              <CheckCircle className="h-6 w-6" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Amount in Dispute</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {formatCurrency(stats.totalDispute)}
              </p>
            </div>
            <div className="rounded-lg bg-red-50 p-3 text-red-700">
              <FileWarning className="h-6 w-6" />
            </div>
          </div>
        </Card>
      </div>

      {/* ─── Cases Table ────────────────────────────────────────────────────── */}
      <Card className="mb-6 overflow-hidden">
        <div className="border-b border-gray-200 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Cases</h2>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search case no. or PIN..."
                className="sm:w-56"
              />
              <Select
                value={filterCaseType}
                onChange={setFilterCaseType}
                options={CASE_TYPE_FILTER_OPTIONS}
                className="sm:w-48"
              />
              <Select
                value={filterStatus}
                onChange={setFilterStatus}
                options={CASE_STATUS_OPTIONS}
                className="sm:w-40"
              />
            </div>
          </div>
        </div>

        {filteredCases.length === 0 ? (
          <EmptyState
            icon={<Gavel className="h-8 w-8" />}
            title="No cases found"
            description="File a new case or adjust your search filters to see results."
            action={
              <Button onClick={openCreateModal}>
                <Gavel className="h-4 w-4" />
                File New Case
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                  <th className="px-4 py-3">Case Number</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">PIN</th>
                  <th className="px-4 py-3">Filed</th>
                  <th className="px-4 py-3">Submission Deadline</th>
                  <th className="px-4 py-3">Decision Deadline</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Amount in Dispute</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCases.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => openDetailModal(c)}
                    className="cursor-pointer transition-colors hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 font-medium text-blue-700">{c.case_number}</td>
                    <td className="px-4 py-3 text-gray-700">{getCaseTypeName(c.case_type)}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {c.property?.pin ?? c.property?.tax_declaration_number ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatDate(c.filed_date)}</td>
                    <td className="px-4 py-3">{renderDeadlineCell(c.submission_deadline)}</td>
                    <td className="px-4 py-3">{renderDeadlineCell(c.decision_deadline)}</td>
                    <td className="px-4 py-3">
                      <Badge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {c.amount_in_dispute ? formatCurrency(c.amount_in_dispute) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ─── Compliance Calendar ────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="border-b border-gray-200 p-4">
          <h2 className="text-lg font-semibold text-gray-900">Compliance Calendar</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Statutory reporting deadlines and submission tracking
          </p>
        </div>

        {complianceEntries.length === 0 ? (
          <EmptyState
            icon={<Clock className="h-8 w-8" />}
            title="No compliance deadlines"
            description="Statutory reporting deadlines will appear here once configured."
          />
        ) : (
          <div className="divide-y divide-gray-100">
            {complianceEntries.map((entry) => {
              const borderClass = getComplianceBorderClass(entry.deadline, entry.status);
              const days = daysUntil(entry.deadline);
              const isOverdue =
                days !== null && days < 0 && entry.status !== 'acknowledged';
              const nextStatus = COMPLIANCE_NEXT_STATUS[entry.status];

              return (
                <div
                  key={entry.id}
                  className={`flex flex-col gap-3 border-l-4 p-4 sm:flex-row sm:items-center sm:justify-between ${borderClass}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{entry.report_name}</p>
                      {isOverdue && <Badge status="overdue" />}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {entry.reporting_authority} &middot; {entry.period}
                    </p>
                    <p className="mt-1 text-xs">
                      <span className="text-gray-500">Deadline: </span>
                      <span
                        className={`font-medium ${isOverdue ? 'text-red-600' : 'text-gray-700'}`}
                      >
                        {formatDate(entry.deadline)}
                      </span>
                      {days !== null && entry.status !== 'acknowledged' && (
                        <span
                          className={`ml-2 ${
                            days < 0
                              ? 'text-red-600'
                              : days <= 14
                                ? 'text-yellow-700'
                                : 'text-blue-600'
                          }`}
                        >
                          {days < 0
                            ? `${Math.abs(days)} days overdue`
                            : `${days} days remaining`}
                        </span>
                      )}
                    </p>
                    {entry.notes && (
                      <p className="mt-1 text-xs text-gray-400">{entry.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge status={entry.status} />
                    {nextStatus && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleComplianceStatusChange(entry.id, nextStatus)}
                      >
                        Advance to {capitalize(nextStatus)}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ─── Create Case Modal ──────────────────────────────────────────────── */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="File New Case"
        size="lg"
      >
        <div className="space-y-4">
          {createError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {createError}
            </div>
          )}

          {createForm.caseNumber && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5">
              <span className="text-xs font-medium text-blue-600">Generated Case Number: </span>
              <span className="text-sm font-bold text-blue-900">{createForm.caseNumber}</span>
            </div>
          )}

          <Select
            label="Case Type"
            value={createForm.caseType}
            onChange={(v) => setCreateForm((p) => ({ ...p, caseType: v }))}
            options={CASE_TYPES.map((t) => ({ value: t.code, label: t.name }))}
            placeholder="Select case type..."
            required
          />

          <Select
            label="Property"
            value={createForm.propertyId}
            onChange={(v) => setCreateForm((p) => ({ ...p, propertyId: v }))}
            options={properties.map((p) => ({
              value: p.id,
              label: `${p.pin ?? 'No PIN'}${p.tax_declaration_number ? ` \u2022 TD ${p.tax_declaration_number}` : ''}`,
            }))}
            placeholder="Select property..."
            required
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Filed Date"
              type="date"
              value={createForm.filedDate}
              onChange={(v) => setCreateForm((p) => ({ ...p, filedDate: v }))}
              required
            />
            {createForm.caseType === 'assessment_appeal' && (
              <Input
                label="Notice Receipt Date"
                type="date"
                value={createForm.noticeReceiptDate}
                onChange={(v) => setCreateForm((p) => ({ ...p, noticeReceiptDate: v }))}
                required
              />
            )}
          </div>

          <Input
            label="Amount in Dispute (PHP)"
            type="number"
            value={createForm.amountInDispute}
            onChange={(v) => setCreateForm((p) => ({ ...p, amountInDispute: v }))}
            placeholder="0.00"
            required
          />

          {(computedDeadlines.submission || computedDeadlines.decision) && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-gray-500">
                Auto-Computed Deadlines
              </p>
              <div className="flex flex-wrap gap-4 text-sm">
                {computedDeadlines.submission && (
                  <div>
                    <span className="text-gray-500">Submission: </span>
                    <span className="font-medium text-gray-900">
                      {formatDate(computedDeadlines.submission)}
                    </span>
                  </div>
                )}
                {computedDeadlines.decision && (
                  <div>
                    <span className="text-gray-500">Decision: </span>
                    <span className="font-medium text-gray-900">
                      {formatDate(computedDeadlines.decision)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <TextArea
            label="Description"
            value={createForm.description}
            onChange={(v) => setCreateForm((p) => ({ ...p, description: v }))}
            placeholder="Describe the case details, grounds for appeal, protest, or claim..."
            rows={4}
            required
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateCase} disabled={creating}>
              {creating ? 'Filing...' : 'File Case'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Case Detail Modal ──────────────────────────────────────────────── */}
      {selectedCase && (
        <Modal
          open={showDetailModal}
          onClose={() => setShowDetailModal(false)}
          title={selectedCase.case_number}
          size="xl"
        >
          <div className="space-y-5">
            {/* Status & workflow actions */}
            <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-500">Status:</span>
                <Badge status={selectedCase.status} />
              </div>
              <div className="flex flex-wrap gap-2">
                {(CASE_STATUS_FLOW[selectedCase.status] ?? []).map((action) => (
                  <Button
                    key={action.nextStatus}
                    size="sm"
                    variant={action.nextStatus === 'dismissed' ? 'danger' : 'primary'}
                    onClick={() => handleStatusChange(action.nextStatus)}
                    disabled={detailLoading}
                  >
                    {action.label}
                  </Button>
                ))}
                {detailLoading && (
                  <span className="text-sm text-gray-400">Updating...</span>
                )}
              </div>
            </div>

            {/* Deadline alerts */}
            {deadlineAlerts.length > 0 && (
              <div className="space-y-2">
                {deadlineAlerts.map((alert, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
                      alert.days < 0
                        ? 'border border-red-200 bg-red-50 text-red-800'
                        : 'border border-yellow-200 bg-yellow-50 text-yellow-800'
                    }`}
                  >
                    <Clock className="h-4 w-4 flex-shrink-0" />
                    <span className="font-medium">{alert.label}:</span>
                    <span>{formatDate(alert.deadline)}</span>
                    <span className="font-semibold">
                      {alert.days < 0
                        ? `${Math.abs(alert.days)} days overdue`
                        : `${alert.days} days remaining`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Case info grid */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500">Case Type</p>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {getCaseTypeName(selectedCase.case_type)}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500">Amount in Dispute</p>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {selectedCase.amount_in_dispute
                    ? formatCurrency(selectedCase.amount_in_dispute)
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500">Property PIN</p>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {selectedCase.property?.pin ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500">
                  Tax Declaration No.
                </p>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {selectedCase.property?.tax_declaration_number ?? '—'}
                </p>
              </div>
            </div>

            {/* Key dates */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Key Dates</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs text-gray-500">Filed Date</p>
                  <p className="mt-0.5 text-sm font-medium text-gray-900">
                    {formatDate(selectedCase.filed_date)}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs text-gray-500">Notice Receipt</p>
                  <p className="mt-0.5 text-sm font-medium text-gray-900">
                    {formatDate(selectedCase.notice_receipt_date)}
                  </p>
                </div>
                <div
                  className={`rounded-lg border p-3 ${getDeadlineBoxClass(selectedCase.submission_deadline)}`}
                >
                  <p className="text-xs text-gray-500">Submission Deadline</p>
                  <p className="mt-0.5 text-sm font-medium text-gray-900">
                    {formatDate(selectedCase.submission_deadline)}
                  </p>
                </div>
                <div
                  className={`rounded-lg border p-3 ${getDeadlineBoxClass(selectedCase.decision_deadline)}`}
                >
                  <p className="text-xs text-gray-500">Decision Deadline</p>
                  <p className="mt-0.5 text-sm font-medium text-gray-900">
                    {formatDate(selectedCase.decision_deadline)}
                  </p>
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500">Description</p>
              <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                {selectedCase.description || 'No description provided.'}
              </p>
            </div>

            {/* Decision */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase text-gray-500">Decision</p>
                {selectedCase.decided_at && (
                  <p className="text-xs text-gray-400">
                    Decided on {formatDate(selectedCase.decided_at)}
                    {selectedCase.decided_by ? ` by ${selectedCase.decided_by}` : ''}
                  </p>
                )}
              </div>
              {selectedCase.status === 'decided' || selectedCase.status === 'dismissed' ? (
                <div className="space-y-2">
                  <TextArea
                    value={decisionText}
                    onChange={setDecisionText}
                    placeholder="Enter the decision details and ruling..."
                    rows={4}
                  />
                  <div className="flex justify-end">
                    <Button size="sm" onClick={handleSaveDecision} disabled={savingDecision}>
                      {savingDecision ? 'Saving...' : 'Save Decision'}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                  {selectedCase.decision_text || 'No decision recorded yet.'}
                </p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
