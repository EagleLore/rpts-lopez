import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ClipboardCheck, Plus, Eye, CheckCircle,
  Send, FileText, AlertCircle, Calculator, Building2, Layers,
  RefreshCw, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  Card, Badge, Button, Modal, Input, Select, TextArea,
  EmptyState, PageHeader,
} from '@/components/ui';
import {
  formatCurrency, formatDate, capitalize, computeAssessedValue,
} from '@/lib/utils';
import { PROPERTY_CLASSIFICATIONS } from '@/lib/constants';
import type {
  Assessment, AssessmentLevel,
} from '@/lib/types';

/* ────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

interface StaffName {
  id: string;
  full_name: string;
}

/** Assessment row with joined relations for the list / detail views. */
interface AssessmentWithJoins extends Omit<Assessment, 'property' | 'property_unit' | 'schedule'> {
  property: { pin: string | null; tax_declaration_number: string | null } | null;
  property_unit: {
    unit_type: string;
    classification: string;
    area: number | null;
    description: string | null;
  } | null;
  schedule: { name: string; version: string } | null;
  preparer: StaffName | null;
  reviewer: StaffName | null;
  approver: StaffName | null;
}

/** Property-unit option for the create form's unit selector. */
interface UnitOption {
  id: string;
  property_id: string;
  pin: string | null;
  tax_declaration_number: string | null;
  unit_type: string;
  classification: string;
  area: number | null;
  description: string | null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Constants                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'cancelled', label: 'Cancelled' },
];

const CLASSIFICATION_OPTIONS = [
  { value: '', label: 'All Classifications' },
  ...PROPERTY_CLASSIFICATIONS.map((c) => ({ value: c, label: capitalize(c) })),
];

const FORM_CLASSIFICATION_OPTIONS = PROPERTY_CLASSIFICATIONS.map((c) => ({
  value: c,
  label: capitalize(c),
}));

const PESOS_TO_CENTAVOS = 100;

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helper — format a PIN label for a unit option                              */
/* ────────────────────────────────────────────────────────────────────────── */

function unitOptionLabel(u: UnitOption): string {
  const pin = u.pin || u.tax_declaration_number || 'No PIN';
  const type = capitalize(u.unit_type);
  const area = u.area != null ? ` · ${u.area} ${u.unit_type === 'land' ? 'sqm' : 'sqm'}` : '';
  return `${pin} — ${type}${area}`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Main component                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export function AssessmentPage() {
  const { staffUser } = useAuth();

  /* ── List state ──────────────────────────────────────────────────────── */
  const [assessments, setAssessments] = useState<AssessmentWithJoins[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');

  /* ── Create modal state ──────────────────────────────────────────────── */
  const [showCreate, setShowCreate] = useState(false);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // form fields
  const [fUnitId, setFUnitId] = useState('');
  const [fTd, setFTd] = useState('');
  const [fAssessmentDate, setFAssessmentDate] = useState(
    new Date().toISOString().split('T')[0],
  );
  const [fEffectiveDate, setFEffectiveDate] = useState(
    new Date().toISOString().split('T')[0],
  );
  const [fMarketValue, setFMarketValue] = useState(''); // pesos
  const [fClassification, setFClassification] = useState('');
  const [fActualUse, setFActualUse] = useState('');
  const [fLevelPercent, setFLevelPercent] = useState('');
  const [fNotes, setFNotes] = useState('');
  const [levelLocked, setLevelLocked] = useState(false); // true when auto-suggested

  /* ── Detail modal state ──────────────────────────────────────────────── */
  const [detailAssessment, setDetailAssessment] = useState<AssessmentWithJoins | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  /* ────────────────────────────────────────────────────────────────────── */
  /*  Data loading                                                           */
  /* ────────────────────────────────────────────────────────────────────── */

  const loadAssessments = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('assessments')
      .select(`
        *,
        property:properties!property_id(pin, tax_declaration_number),
        property_unit:property_units!property_unit_id(unit_type, classification, area, description),
        schedule:valuation_schedules(name, version),
        preparer:staff_users!prepared_by(id, full_name),
        reviewer:staff_users!reviewed_by(id, full_name),
        approver:staff_users!approved_by(id, full_name)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to load assessments:', error);
    }
    setAssessments((data ?? []) as unknown as AssessmentWithJoins[]);
    setLoading(false);
  }, []);

  const loadUnits = useCallback(async () => {
    setUnitsLoading(true);
    const { data, error } = await supabase
      .from('property_units')
      .select(`
        id, property_id, unit_type, classification, area, description,
        property:properties!property_id(pin, tax_declaration_number)
      `)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to load property units:', error);
    }
    const mapped: UnitOption[] = (data ?? []).map((row) => {
      const r = row as unknown as {
        id: string; property_id: string; unit_type: string;
        classification: string; area: number | null; description: string | null;
        property: { pin: string | null; tax_declaration_number: string | null } | null;
      };
      return {
        id: r.id,
        property_id: r.property_id,
        pin: r.property?.pin ?? null,
        tax_declaration_number: r.property?.tax_declaration_number ?? null,
        unit_type: r.unit_type,
        classification: r.classification,
        area: r.area,
        description: r.description,
      };
    });
    setUnits(mapped);
    setUnitsLoading(false);
  }, []);

  useEffect(() => {
    loadAssessments();
  }, [loadAssessments]);

  /* ────────────────────────────────────────────────────────────────────── */
  /*  Auto-suggest assessment level                                           */
  /* ────────────────────────────────────────────────────────────────────── */

  // When unit or classification changes, look up the active assessment level.
  const selectedUnit = useMemo(
    () => units.find((u) => u.id === fUnitId) ?? null,
    [units, fUnitId],
  );

  useEffect(() => {
    if (!fUnitId || !fClassification || !selectedUnit) return;

    let cancelled = false;

    async function suggestLevel() {
      const { data, error } = await supabase
        .from('assessment_levels')
        .select('*')
        .eq('status', 'active')
        .eq('classification', fClassification)
        .eq('property_type', selectedUnit?.unit_type ?? '')
        .order('effective_date', { ascending: false })
        .limit(1);

      if (error) {
        console.error('Failed to load assessment levels:', error);
        return;
      }

      if (cancelled) return;

      const level = (data ?? []) as AssessmentLevel[];
      if (level.length > 0) {
        setFLevelPercent(String(level[0].level_percent));
        setLevelLocked(true);
      } else {
        // No matching schedule — leave editable, clear lock.
        setLevelLocked(false);
      }
    }

    suggestLevel();
    return () => { cancelled = true; };
  }, [fUnitId, fClassification, selectedUnit]);

  /* ────────────────────────────────────────────────────────────────────── */
  /*  Derived: computed assessed value (display, in pesos)                    */
  /* ────────────────────────────────────────────────────────────────────── */

  const computedAssessedValuePesos = useMemo(() => {
    const mv = parseFloat(fMarketValue);
    const lvl = parseFloat(fLevelPercent);
    if (isNaN(mv) || isNaN(lvl) || mv <= 0 || lvl <= 0) return 0;
    // computeAssessedValue works on centavos; input market value in pesos → centavos
    const marketCentavos = Math.round(mv * PESOS_TO_CENTAVOS);
    const assessedCentavos = computeAssessedValue(marketCentavos, lvl);
    return assessedCentavos / PESOS_TO_CENTAVOS;
  }, [fMarketValue, fLevelPercent]);

  /* ────────────────────────────────────────────────────────────────────── */
  /*  Filtering                                                              */
  /* ────────────────────────────────────────────────────────────────────── */

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assessments.filter((a) => {
      if (statusFilter && a.status !== statusFilter) return false;
      if (classFilter && a.classification !== classFilter) return false;
      if (q) {
        const td = (a.tax_declaration_number ?? '').toLowerCase();
        const pin = (a.property?.pin ?? '').toLowerCase();
        if (!td.includes(q) && !pin.includes(q)) return false;
      }
      return true;
    });
  }, [assessments, search, statusFilter, classFilter]);

  /* ────────────────────────────────────────────────────────────────────── */
  /*  Create form helpers                                                    */
  /* ────────────────────────────────────────────────────────────────────── */

  function resetForm() {
    setFUnitId('');
    setFTd('');
    setFAssessmentDate(new Date().toISOString().split('T')[0]);
    setFEffectiveDate(new Date().toISOString().split('T')[0]);
    setFMarketValue('');
    setFClassification('');
    setFActualUse('');
    setFLevelPercent('');
    setFNotes('');
    setLevelLocked(false);
    setCreateError(null);
  }

  function openCreate() {
    resetForm();
    loadUnits();
    setShowCreate(true);
  }

  async function handleCreate() {
    setCreateError(null);

    // Validation
    if (!fUnitId) { setCreateError('Please select a property unit.'); return; }
    if (!fClassification) { setCreateError('Please select a classification.'); return; }
    const mv = parseFloat(fMarketValue);
    if (isNaN(mv) || mv <= 0) { setCreateError('Please enter a valid market value.'); return; }
    const lvl = parseFloat(fLevelPercent);
    if (isNaN(lvl) || lvl < 0 || lvl > 100) { setCreateError('Assessment level must be between 0 and 100.'); return; }
    if (!fAssessmentDate) { setCreateError('Please enter an assessment date.'); return; }
    if (!fEffectiveDate) { setCreateError('Please enter an effective date.'); return; }

    const unit = units.find((u) => u.id === fUnitId);
    if (!unit) { setCreateError('Selected property unit not found.'); return; }

    const marketCentavos = Math.round(mv * PESOS_TO_CENTAVOS);
    const assessedCentavos = computeAssessedValue(marketCentavos, lvl);

    setCreating(true);
    const { error } = await supabase.from('assessments').insert({
      property_unit_id: unit.id,
      property_id: unit.property_id,
      tax_declaration_number: fTd || null,
      assessment_date: fAssessmentDate,
      effective_date: fEffectiveDate,
      market_value: marketCentavos,
      classification: fClassification,
      actual_use: fActualUse || null,
      assessment_level_percent: lvl,
      assessed_value: assessedCentavos,
      status: 'draft',
      prepared_by: staffUser?.id ?? null,
      notes: fNotes || null,
    });

    setCreating(false);

    if (error) {
      setCreateError(error.message || 'Failed to create assessment.');
      return;
    }

    setShowCreate(false);
    resetForm();
    await loadAssessments();
  }

  /* ────────────────────────────────────────────────────────────────────── */
  /*  Workflow actions                                                        */
  /* ────────────────────────────────────────────────────────────────────── */

  async function updateStatus(
    assessment: AssessmentWithJoins,
    newStatus: 'pending_review' | 'approved' | 'cancelled',
  ) {
    setActionLoading(true);

    const patch: Record<string, unknown> = { status: newStatus };

    if (newStatus === 'pending_review') {
      patch.reviewed_by = staffUser?.id ?? null;
    }
    if (newStatus === 'approved') {
      patch.approved_by = staffUser?.id ?? null;
      patch.approved_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('assessments')
      .update(patch)
      .eq('id', assessment.id)
      .select(`
        *,
        property:properties!property_id(pin, tax_declaration_number),
        property_unit:property_units!property_unit_id(unit_type, classification, area, description),
        schedule:valuation_schedules(name, version),
        preparer:staff_users!prepared_by(id, full_name),
        reviewer:staff_users!reviewed_by(id, full_name),
        approver:staff_users!approved_by(id, full_name)
      `)
      .maybeSingle();

    setActionLoading(false);

    if (error) {
      console.error('Failed to update status:', error);
      return;
    }

    const updated = data as unknown as AssessmentWithJoins;
    setDetailAssessment(updated);
    setAssessments((prev) =>
      prev.map((a) => (a.id === updated.id ? updated : a)),
    );
  }

  /* ────────────────────────────────────────────────────────────────────── */
  /*  Render                                                                  */
  /* ────────────────────────────────────────────────────────────────────── */

  return (
    <div>
      <PageHeader
        title="Assessment & Valuation"
        description="Create, review, and approve property tax assessments"
        action={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New Assessment
          </Button>
        }
      />

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              label="Search"
              value={search}
              onChange={setSearch}
              placeholder="Search by TD number or PIN…"
            />
          </div>
          <div className="sm:w-48">
            <Select
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_OPTIONS}
            />
          </div>
          <div className="sm:w-48">
            <Select
              label="Classification"
              value={classFilter}
              onChange={setClassFilter}
              options={CLASSIFICATION_OPTIONS}
            />
          </div>
          <Button variant="outline" onClick={() => { setSearch(''); setStatusFilter(''); setClassFilter(''); }}>
            <X className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-700" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck className="h-8 w-8" />}
            title="No assessments found"
            description={
              assessments.length === 0
                ? 'Get started by creating your first property assessment.'
                : 'Try adjusting your filters or search terms.'
            }
            action={
              assessments.length === 0 ? (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  New Assessment
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">TD No.</th>
                  <th className="px-4 py-3">PIN</th>
                  <th className="px-4 py-3">Classification</th>
                  <th className="px-4 py-3 text-right">Market Value</th>
                  <th className="px-4 py-3 text-right">Level</th>
                  <th className="px-4 py-3 text-right">Assessed Value</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Assessment Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {a.tax_declaration_number || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {a.property?.pin || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {capitalize(a.classification)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 tabular-nums">
                      {formatCurrency(a.market_value)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600 tabular-nums">
                      {Number(a.assessment_level_percent).toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                      {formatCurrency(a.assessed_value)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={a.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatDate(a.assessment_date)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetailAssessment(a)}
                      >
                        <Eye className="h-4 w-4" />
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="border-t border-gray-200 px-4 py-3 text-xs text-gray-500">
            Showing {filtered.length} of {assessments.length} assessments
          </div>
        )}
      </Card>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/*  Create Modal                                                       */}
      {/* ────────────────────────────────────────────────────────────────── */}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Assessment"
        size="xl"
      >
        <div className="space-y-5">
          {createError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
              <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-600" />
              <p className="text-sm text-red-800">{createError}</p>
            </div>
          )}

          {/* Property unit selection */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Property Unit <span className="text-red-500">*</span>
            </label>
            <select
              value={fUnitId}
              onChange={(e) => {
                setFUnitId(e.target.value);
                const u = units.find((x) => x.id === e.target.value);
                if (u && !fClassification) setFClassification(u.classification);
                if (u && !fTd && u.tax_declaration_number) setFTd(u.tax_declaration_number);
              }}
              required
              disabled={unitsLoading}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
            >
              <option value="">
                {unitsLoading ? 'Loading property units…' : 'Select a property unit…'}
              </option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {unitOptionLabel(u)}
                </option>
              ))}
            </select>
            {selectedUnit && (
              <div className="mt-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  <span><strong>Type:</strong> {capitalize(selectedUnit.unit_type)}</span>
                  <span><strong>Classification:</strong> {capitalize(selectedUnit.classification)}</span>
                  {selectedUnit.area != null && (
                    <span><strong>Area:</strong> {selectedUnit.area} sqm</span>
                  )}
                  {selectedUnit.description && (
                    <span><strong>Description:</strong> {selectedUnit.description}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* TD number + dates */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label="Tax Declaration No."
              value={fTd}
              onChange={setFTd}
              placeholder="TD-2026-0001"
            />
            <Input
              label="Assessment Date"
              type="date"
              value={fAssessmentDate}
              onChange={setFAssessmentDate}
              required
            />
            <Input
              label="Effective Date"
              type="date"
              value={fEffectiveDate}
              onChange={setFEffectiveDate}
              required
            />
          </div>

          {/* Market value + classification + actual use */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label="Market Value (₱)"
              type="number"
              value={fMarketValue}
              onChange={setFMarketValue}
              placeholder="0.00"
              required
            />
            <Select
              label="Classification"
              value={fClassification}
              onChange={(v) => { setFClassification(v); setLevelLocked(false); }}
              options={FORM_CLASSIFICATION_OPTIONS}
              placeholder="Select classification"
              required
            />
            <Input
              label="Actual Use"
              value={fActualUse}
              onChange={setFActualUse}
              placeholder="e.g. Residential dwelling"
            />
          </div>

          {/* Assessment level + computed value */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Input
                label="Assessment Level (%)"
                type="number"
                value={fLevelPercent}
                onChange={(v) => { setFLevelPercent(v); setLevelLocked(false); }}
                placeholder="e.g. 20"
                required
              />
              {levelLocked && (
                <p className="mt-1 flex items-center gap-1 text-xs text-blue-600">
                  <CheckCircle className="h-3 w-3" />
                  Auto-suggested from assessment schedule
                </p>
              )}
              {!levelLocked && fClassification && (
                <p className="mt-1 text-xs text-gray-400">
                  No matching schedule found — enter manually.
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Computed Assessed Value
              </label>
              <div className="flex h-[38px] items-center rounded-lg border border-gray-200 bg-blue-50 px-3 text-sm font-semibold text-blue-900 tabular-nums">
                {formatCurrency(Math.round(computedAssessedValuePesos * PESOS_TO_CENTAVOS))}
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Market Value × Level ÷ 100
              </p>
            </div>
          </div>

          {/* Notes */}
          <TextArea
            label="Notes"
            value={fNotes}
            onChange={setFNotes}
            placeholder="Optional remarks about this assessment…"
            rows={3}
          />

          {/* Actions */}
          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Saving…
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4" />
                  Create as Draft
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/*  Detail Modal                                                       */}
      {/* ────────────────────────────────────────────────────────────────── */}

      <Modal
        open={detailAssessment !== null}
        onClose={() => setDetailAssessment(null)}
        title="Assessment Detail"
        size="xl"
      >
        {detailAssessment && (
          <DetailView
            assessment={detailAssessment}
            actionLoading={actionLoading}
            onStatusChange={updateStatus}
            onRefresh={loadAssessments}
          />
        )}
      </Modal>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Detail view sub-component                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

interface DetailViewProps {
  assessment: AssessmentWithJoins;
  actionLoading: boolean;
  onStatusChange: (
    a: AssessmentWithJoins,
    status: 'pending_review' | 'approved' | 'cancelled',
  ) => void;
  onRefresh: () => void;
}

function DetailView({ assessment, actionLoading, onStatusChange, onRefresh }: DetailViewProps) {
  const a = assessment;
  const marketPesos = a.market_value;
  const assessedPesos = a.assessed_value;
  const level = Number(a.assessment_level_percent);

  return (
    <div className="space-y-5">
      {/* Status + key identifiers */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge status={a.status} />
        <span className="text-sm text-gray-500">
          TD No.: <span className="font-medium text-gray-900">{a.tax_declaration_number || '—'}</span>
        </span>
        <span className="text-sm text-gray-500">
          PIN: <span className="font-medium text-gray-900">{a.property?.pin || '—'}</span>
        </span>
      </div>

      {/* Computation breakdown */}
      <div>
        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Calculator className="h-4 w-4 text-gray-400" />
          Valuation Computation
        </h4>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              <tr>
                <td className="bg-gray-50 px-4 py-2.5 font-medium text-gray-600">Market Value</td>
                <td className="px-4 py-2.5 text-right text-gray-900 tabular-nums">
                  {formatCurrency(marketPesos)}
                </td>
              </tr>
              <tr>
                <td className="bg-gray-50 px-4 py-2.5 font-medium text-gray-600">Classification</td>
                <td className="px-4 py-2.5 text-right text-gray-900">
                  {capitalize(a.classification)}
                </td>
              </tr>
              <tr>
                <td className="bg-gray-50 px-4 py-2.5 font-medium text-gray-600">Assessment Level</td>
                <td className="px-4 py-2.5 text-right text-gray-900 tabular-nums">
                  {level.toFixed(2)}%
                </td>
              </tr>
              <tr className="bg-blue-50">
                <td className="px-4 py-3 font-semibold text-blue-900">
                  Assessed Value
                  <span className="ml-2 text-xs font-normal text-blue-600">
                    ({formatCurrency(marketPesos)} × {level.toFixed(2)}%)
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-lg font-bold text-blue-900 tabular-nums">
                  {formatCurrency(assessedPesos)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Formula: Assessed Value = Market Value × Assessment Level ÷ 100.
          All monetary values are stored in centavos and displayed in pesos.
        </p>
      </div>

      {/* Two-column: unit details + assessment details */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Property unit details */}
        <div>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Building2 className="h-4 w-4 text-gray-400" />
            Property Unit
          </h4>
          <dl className="space-y-2 rounded-lg border border-gray-200 p-4 text-sm">
            <DetailRow label="Unit Type" value={a.property_unit ? capitalize(a.property_unit.unit_type) : '—'} />
            <DetailRow label="Classification" value={a.property_unit ? capitalize(a.property_unit.classification) : '—'} />
            <DetailRow label="Area" value={a.property_unit?.area != null ? `${a.property_unit.area} sqm` : '—'} />
            <DetailRow label="Description" value={a.property_unit?.description || '—'} />
            <DetailRow label="Actual Use" value={a.actual_use || '—'} />
          </dl>
        </div>

        {/* Assessment details */}
        <div>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
            <FileText className="h-4 w-4 text-gray-400" />
            Assessment Details
          </h4>
          <dl className="space-y-2 rounded-lg border border-gray-200 p-4 text-sm">
            <DetailRow label="Assessment Date" value={formatDate(a.assessment_date)} />
            <DetailRow label="Effective Date" value={formatDate(a.effective_date)} />
            <DetailRow
              label="Schedule Reference"
              value={a.schedule ? `${a.schedule.name} (v${a.schedule.version})` : '—'}
            />
            <DetailRow label="Notes" value={a.notes || '—'} />
          </dl>
        </div>
      </div>

      {/* Workflow — who did what */}
      <div>
        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Layers className="h-4 w-4 text-gray-400" />
          Approval Workflow
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <WorkflowCard
            label="Prepared By"
            name={a.preparer?.full_name}
            date={a.created_at}
          />
          <WorkflowCard
            label="Reviewed By"
            name={a.reviewer?.full_name}
            date={null}
          />
          <WorkflowCard
            label="Approved By"
            name={a.approver?.full_name}
            date={a.approved_at}
          />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 pt-4">
        <Button variant="ghost" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>

        {a.status === 'draft' && (
          <>
            <Button
              variant="danger"
              onClick={() => onStatusChange(a, 'cancelled')}
              disabled={actionLoading}
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button
              onClick={() => onStatusChange(a, 'pending_review')}
              disabled={actionLoading}
            >
              <Send className="h-4 w-4" />
              Submit for Review
            </Button>
          </>
        )}

        {a.status === 'pending_review' && (
          <>
            <Button
              variant="danger"
              onClick={() => onStatusChange(a, 'cancelled')}
              disabled={actionLoading}
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button
              onClick={() => onStatusChange(a, 'approved')}
              disabled={actionLoading}
            >
              <CheckCircle className="h-4 w-4" />
              Approve Assessment
            </Button>
          </>
        )}

        {a.status === 'approved' && (
          <div className="flex items-center gap-2 text-sm font-medium text-green-700">
            <CheckCircle className="h-4 w-4" />
            Assessment approved and finalized
          </div>
        )}

        {a.status === 'cancelled' && (
          <div className="flex items-center gap-2 text-sm font-medium text-red-600">
            <X className="h-4 w-4" />
            Assessment cancelled
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Small presentational helpers                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-gray-900">{value}</dd>
    </div>
  );
}

function WorkflowCard({
  label, name, date,
}: {
  label: string;
  name: string | null | undefined;
  date: string | null;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">
        {name || <span className="text-gray-400">Pending</span>}
      </p>
      {date && <p className="mt-0.5 text-xs text-gray-400">{formatDate(date)}</p>}
    </div>
  );
}
