import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  HandCoins, Search, Receipt as ReceiptIcon, Wallet, Printer,
  CheckCircle2, AlertCircle, Loader2, Lock, Unlock, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, Badge, Button, Modal, Input, Select, TextArea, EmptyState, PageHeader } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import {
  formatCurrency, formatDateTime, formatDate, computeInterest,
  computeRevenueShares, generateReceiptNumber, generateSessionNumber, capitalize,
} from '@/lib/utils';
import { PAYMENT_METHODS } from '@/lib/constants';
import type {
  TaxCharge, Payment, PaymentAllocation, Receipt, CashSession,
} from '@/lib/types';

/* ────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

/** Shape returned by the joined tax_charges query. */
interface TaxChargeWithProperty extends Omit<TaxCharge, 'property'> {
  property: { pin: string | null; tax_declaration_number: string | null } | null;
}

/** A charge augmented with live interest computed in the browser. */
interface ChargeWithInterest extends TaxChargeWithProperty {
  interest_accrued: number;
  total_due: number;
}

/** Payment row with nested allocations + receipt for the history/receipt view. */
interface PaymentWithDetails extends Omit<Payment, 'allocations' | 'receipt'> {
  allocations?: AllocationWithCharge[];
  receipt?: Receipt | null;
}

/** Allocation row with its parent tax charge for receipt display. */
interface AllocationWithCharge extends Omit<PaymentAllocation, 'tax_charge'> {
  tax_charge?: { tax_year: number; quarter: number; levy_type: string } | null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Constants                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

const PAYER_TYPES = [
  { value: 'taxpayer', label: 'Taxpayer' },
  { value: 'representative', label: 'Representative' },
  { value: 'agent', label: 'Agent' },
];

const PAYMENT_METHOD_OPTIONS = PAYMENT_METHODS.map((m) => ({ value: m.code, label: m.name }));

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** Decorate a raw charge with live interest and total-due figures. */
function withInterest(charge: TaxChargeWithProperty, asOf = new Date()): ChargeWithInterest {
  const balance = charge.balance ?? 0;
  const interest = balance > 0 ? computeInterest(balance, charge.due_date, asOf) : 0;
  return {
    ...charge,
    interest_accrued: interest,
    total_due: balance + interest,
  };
}

/** Human label for a levy code. */
function levyLabel(code: string): string {
  const map: Record<string, string> = {
    basic: 'Basic RPT',
    sef: 'SEF Tax',
    idle_land: 'Idle Land Tax',
    special_levy: 'Special Levy',
  };
  return map[code] ?? capitalize(code);
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Component                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export function CollectionPage() {
  const { staffUser } = useAuth();

  /* ── Tab state ───────────────────────────────────────────────────────── */
  const [activeTab, setActiveTab] = useState<'collect' | 'history' | 'session'>('collect');

  /* ── State: collection screen ────────────────────────────────────────── */
  const [searchTerm, setSearchTerm] = useState('');
  const [searched, setSearched] = useState(false);
  const [charges, setCharges] = useState<ChargeWithInterest[]>([]);
  const [loadingCharges, setLoadingCharges] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Payment form
  const [payerName, setPayerName] = useState('');
  const [payerType, setPayerType] = useState('taxpayer');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [tenderInput, setTenderInput] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{
    receiptNumber: string;
    changeDue: number;
    totalAllocated: number;
  } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* ── State: payment history ──────────────────────────────────────────── */
  const [payments, setPayments] = useState<PaymentWithDetails[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [receiptPayment, setReceiptPayment] = useState<PaymentWithDetails | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  /* ── State: cash session ─────────────────────────────────────────────── */
  const [cashSession, setCashSession] = useState<CashSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [closingSession, setClosingSession] = useState(false);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  Data loading                                                            */
  /* ──────────────────────────────────────────────────────────────────────── */

  /** Load outstanding charges for a property identified by PIN or TD number. */
  const searchCharges = useCallback(async () => {
    const term = searchTerm.trim();
    if (!term) return;

    setLoadingCharges(true);
    setChargeError(null);
    setSearched(true);
    setSelectedIds(new Set());

    const { data, error: fetchError } = await supabase
      .from('tax_charges')
      .select<string, TaxChargeWithProperty>(`
        *,
        property:properties!property_id(pin, tax_declaration_number)
      `)
      .in('status', ['unpaid', 'partially_paid'])
      .or(`property.pin.ilike.%${term}%,property.tax_declaration_number.ilike.%${term}%`)
      .order('due_date', { ascending: true });

    if (fetchError) {
      setChargeError(fetchError.message);
      setCharges([]);
    } else {
      setCharges((data ?? []).map((c) => withInterest(c)));
    }
    setLoadingCharges(false);
  }, [searchTerm]);

  /** Load recent payments for the history tab. */
  const loadPayments = useCallback(async () => {
    setLoadingPayments(true);
    setPaymentError(null);

    const { data, error: fetchError } = await supabase
      .from('payments')
      .select<string, PaymentWithDetails>(`
        *,
        allocations:payment_allocations(
          *,
          tax_charge:tax_charges(tax_year, quarter, levy_type)
        ),
        receipt:receipts(*)
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (fetchError) {
      setPaymentError(fetchError.message);
      setPayments([]);
    } else {
      setPayments(data ?? []);
    }
    setLoadingPayments(false);
  }, []);

  /** Load the current open cash session for this cashier. */
  const loadCashSession = useCallback(async () => {
    if (!staffUser) return;
    setLoadingSession(true);
    setSessionError(null);

    const { data, error: fetchError } = await supabase
      .from('cash_sessions')
      .select<string, CashSession>('*')
      .eq('cashier_id', staffUser.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      setSessionError(fetchError.message);
      setCashSession(null);
    } else {
      setCashSession(data);
    }
    setLoadingSession(false);
  }, [staffUser]);

  useEffect(() => {
    loadPayments();
    loadCashSession();
  }, [loadPayments, loadCashSession]);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  Derived values                                                          */
  /* ──────────────────────────────────────────────────────────────────────── */

  /** Total due across selected charges (balance + accrued interest). */
  const selectedTotal = useMemo(() => {
    return charges
      .filter((c) => selectedIds.has(c.id))
      .reduce((sum, c) => sum + c.total_due, 0);
  }, [charges, selectedIds]);

  /** Tender amount in centavos (user enters pesos). */
  const tenderCentavos = useMemo(() => {
    const n = parseFloat(tenderInput);
    return isNaN(n) ? 0 : Math.round(n * 100);
  }, [tenderInput]);

  const changeDue = Math.max(0, tenderCentavos - selectedTotal);
  const isUnderTender = tenderCentavos > 0 && tenderCentavos < selectedTotal;
  const canSubmit =
    selectedIds.size > 0 &&
    payerName.trim().length > 0 &&
    tenderCentavos >= selectedTotal &&
    !submitting;

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  Selection helpers                                                       */
  /* ──────────────────────────────────────────────────────────────────────── */

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(charges.map((c) => c.id)));
  }

  function selectNone() {
    setSelectedIds(new Set());
  }

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  Submit payment                                                          */
  /* ──────────────────────────────────────────────────────────────────────── */

  async function submitPayment() {
    setSubmitError(null);
    setSuccess(null);

    if (!payerName.trim()) {
      setSubmitError('Payer name is required.');
      return;
    }
    if (selectedIds.size === 0) {
      setSubmitError('Select at least one charge to pay.');
      return;
    }
    if (tenderCentavos < selectedTotal) {
      setSubmitError('Tender amount is less than the total due.');
      return;
    }

    setSubmitting(true);

    try {
      const selectedCharges = charges
        .filter((c) => selectedIds.has(c.id))
        // Arrears-first: oldest due_date first (charges already sorted ascending).
        .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

      const totalAllocated = selectedTotal; // balance + interest for selected
      const change = tenderCentavos - totalAllocated;
      const nowIso = new Date().toISOString();

      // 1. Create the payment record.
      const { data: paymentRow, error: paymentErr } = await supabase
        .from('payments')
        .insert({
          property_id: selectedCharges[0]?.property_id ?? null,
          payer_name: payerName.trim(),
          payer_type: payerType,
          payment_method: paymentMethod,
          tender_amount: tenderCentavos,
          total_allocated: totalAllocated,
          change_amount: change,
          payment_date: nowIso,
          status: 'initiated',
          cash_session_id: cashSession?.id ?? null,
          collected_by: staffUser?.id ?? null,
          notes: paymentNotes.trim() || null,
        })
        .select<string, Payment>()
        .single();

      if (paymentErr) throw new Error(paymentErr.message);
      const paymentId = paymentRow.id;

      // 2. Allocate payment to selected charges (oldest first).
      let remaining = totalAllocated;
      const allocationRows: Record<string, unknown>[] = [];
      const chargeUpdates: { id: string; paid_amount: number; balance: number; status: string }[] = [];

      for (const c of selectedCharges) {
        if (remaining <= 0) break;

        const principalPortion = c.balance ?? 0;
        const interestPortion = c.interest_accrued;
        const chargeTotal = principalPortion + interestPortion;
        const allocate = Math.min(remaining, chargeTotal);

        // Split the allocation between principal and interest (interest first up to its share).
        const allocInterest = Math.min(interestPortion, allocate);
        const allocPrincipal = allocate - allocInterest;

        const shares = computeRevenueShares(allocate, c.levy_type);

        allocationRows.push({
          payment_id: paymentId,
          tax_charge_id: c.id,
          allocated_amount: allocate,
          principal_amount: allocPrincipal,
          interest_amount: allocInterest,
          discount_amount: 0,
          share_province: shares.share_province,
          share_municipality: shares.share_municipality,
          share_barangay: shares.share_barangay,
          share_sef_province: shares.share_sef_province,
          share_sef_municipality: shares.share_sef_municipality,
        });

        const newPaid = (c.paid_amount ?? 0) + allocPrincipal;
        const newBalance = (c.balance ?? 0) - allocPrincipal;
        const newStatus = newBalance <= 0 ? 'paid' : 'partially_paid';

        chargeUpdates.push({
          id: c.id,
          paid_amount: newPaid,
          balance: Math.max(0, newBalance),
          status: newStatus,
        });

        remaining -= allocate;
      }

      // 3. Insert allocations.
      if (allocationRows.length > 0) {
        const { error: allocErr } = await supabase
          .from('payment_allocations')
          .insert(allocationRows);
        if (allocErr) throw new Error(allocErr.message);
      }

      // 4. Update each tax_charge.
      for (const cu of chargeUpdates) {
        const { error: updErr } = await supabase
          .from('tax_charges')
          .update({
            paid_amount: cu.paid_amount,
            balance: cu.balance,
            status: cu.status,
          })
          .eq('id', cu.id);
        if (updErr) throw new Error(updErr.message);
      }

      // 5. Create the receipt.
      const receiptNumber = generateReceiptNumber();
      const { data: receiptRow, error: receiptErr } = await supabase
        .from('receipts')
        .insert({
          receipt_number: receiptNumber,
          payment_id: paymentId,
          property_id: selectedCharges[0]?.property_id ?? null,
          amount: totalAllocated,
          issued_date: nowIso,
          issued_by: staffUser?.id ?? null,
          status: 'issued',
        })
        .select<string, Receipt>()
        .single();

      if (receiptErr) throw new Error(receiptErr.message);

      // 6. Update payment with receipt_id and status='receipted'.
      const { error: updPayErr } = await supabase
        .from('payments')
        .update({ receipt_id: receiptRow.id, status: 'receipted' })
        .eq('id', paymentId);
      if (updPayErr) throw new Error(updPayErr.message);

      // 7. Update cash session totals (if a session is open).
      if (cashSession) {
        const { error: sessErr } = await supabase
          .from('cash_sessions')
          .update({
            total_collected: (cashSession.total_collected ?? 0) + totalAllocated,
            total_receipts: (cashSession.total_receipts ?? 0) + 1,
          })
          .eq('id', cashSession.id);
        if (sessErr) throw new Error(sessErr.message);
      }

      // Success — show receipt info and reset form.
      setSuccess({ receiptNumber, changeDue: change, totalAllocated });
      setPayerName('');
      setPayerType('taxpayer');
      setPaymentMethod('cash');
      setTenderInput('');
      setPaymentNotes('');
      setSelectedIds(new Set());
      setCharges([]);
      setSearched(false);
      setSearchTerm('');

      // Refresh history + session.
      loadPayments();
      loadCashSession();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'An unexpected error occurred while processing the payment.');
    } finally {
      setSubmitting(false);
    }
  }

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  Cash session actions                                                   */
  /* ──────────────────────────────────────────────────────────────────────── */

  async function openSession() {
    if (!staffUser) return;
    setSessionError(null);
    const sessionNumber = generateSessionNumber();
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('cash_sessions')
      .insert({
        session_number: sessionNumber,
        cashier_id: staffUser.id,
        opened_at: nowIso,
        opening_balance: 0,
        closing_balance: null,
        total_collected: 0,
        total_receipts: 0,
        status: 'open',
      })
      .select<string, CashSession>()
      .single();

    if (error) {
      setSessionError(error.message);
    } else {
      setCashSession(data);
    }
  }

  async function closeSession() {
    if (!cashSession) return;
    setClosingSession(true);
    setSessionError(null);

    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from('cash_sessions')
      .update({
        closed_at: nowIso,
        closing_balance: cashSession.total_collected ?? 0,
        status: 'closed',
      })
      .eq('id', cashSession.id);

    if (error) {
      setSessionError(error.message);
    } else {
      setCashSession(null);
    }
    setClosingSession(false);
  }

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  Receipt modal loader                                                   */
  /* ──────────────────────────────────────────────────────────────────────── */

  async function openReceiptModal(payment: PaymentWithDetails) {
    setReceiptPayment(payment);
    setReceiptLoading(true);

    // If allocations weren't already nested, fetch them.
    if (!payment.allocations || payment.allocations.length === 0) {
      const { data } = await supabase
        .from('payment_allocations')
        .select<string, AllocationWithCharge>(`
          *,
          tax_charge:tax_charges(tax_year, quarter, levy_type)
        `)
        .eq('payment_id', payment.id);

      if (data) {
        setReceiptPayment({ ...payment, allocations: data });
      }
    }
    setReceiptLoading(false);
  }

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  Render                                                                  */
  /* ──────────────────────────────────────────────────────────────────────── */

  return (
    <div>
      <PageHeader
        title="Collection & Payment"
        description="Collect real property tax payments, issue receipts, and manage cashier cash sessions."
        action={
          <div className="flex items-center gap-2">
            {cashSession ? (
              <Badge status="open" label={`Session ${cashSession.session_number}`} />
            ) : (
              <Badge status="inactive" label="No open session" />
            )}
          </div>
        }
      />

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="mb-6 flex gap-1 border-b border-gray-200">
        {[
          { key: 'collect', label: 'Collect Payment', icon: HandCoins },
          { key: 'history', label: 'Payment History', icon: ReceiptIcon },
          { key: 'session', label: 'Cash Session', icon: Wallet },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
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
      {/*  Tab: Collect Payment                                                */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'collect' && (
        <div className="space-y-6">
          {/* Success banner */}
          {success && (
            <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-5 py-4">
              <CheckCircle2 className="mt-0.5 h-6 w-6 flex-shrink-0 text-green-600" />
              <div className="flex-1">
                <h3 className="text-sm font-bold text-green-900">Payment Receipted Successfully</h3>
                <p className="mt-1 text-sm text-green-800">
                  Receipt No: <strong>{success.receiptNumber}</strong>
                </p>
                <p className="mt-0.5 text-sm text-green-800">
                  Total Allocated: <strong>{formatCurrency(success.totalAllocated)}</strong>
                  {' · '}
                  Change Due: <strong>{formatCurrency(success.changeDue)}</strong>
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSuccess(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Search box */}
          <Card className="p-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Search Property by PIN or Tax Declaration Number
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') searchCharges(); }}
                  placeholder="e.g. 123-456-001 or TD-2024-0001"
                  className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <Button onClick={searchCharges} disabled={!searchTerm.trim() || loadingCharges}>
                {loadingCharges ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Search
              </Button>
            </div>
          </Card>

          {chargeError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{chargeError}</span>
            </div>
          )}

          {submitError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Outstanding charges table */}
          {searched && (
            <Card className="overflow-hidden">
              {loadingCharges ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-700" />
                </div>
              ) : charges.length === 0 ? (
                <EmptyState
                  icon={<HandCoins className="h-8 w-8" />}
                  title="No Outstanding Charges"
                  description="No unpaid or partially-paid charges were found for this property."
                />
              ) : (
                <>
                  <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
                    <p className="text-sm font-medium text-gray-700">
                      Outstanding Charges — {charges.length} found
                    </p>
                    <div className="flex gap-2">
                      <button onClick={selectAll} className="text-xs font-medium text-blue-700 hover:text-blue-800">
                        Select All
                      </button>
                      <span className="text-gray-300">|</span>
                      <button onClick={selectNone} className="text-xs font-medium text-blue-700 hover:text-blue-800">
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-4 py-3 w-10"></th>
                          <th className="px-4 py-3">Year</th>
                          <th className="px-4 py-3">Quarter</th>
                          <th className="px-4 py-3">Levy Type</th>
                          <th className="px-4 py-3 text-right">Gross Amount</th>
                          <th className="px-4 py-3 text-right">Interest Accrued</th>
                          <th className="px-4 py-3 text-right">Balance Due</th>
                          <th className="px-4 py-3 text-right">Total Due</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {charges.map((c) => {
                          const checked = selectedIds.has(c.id);
                          return (
                            <tr
                              key={c.id}
                              className={`cursor-pointer transition-colors ${checked ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                              onClick={() => toggleSelect(c.id)}
                            >
                              <td className="px-4 py-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleSelect(c.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-4 w-4 rounded border-gray-300 text-blue-700 focus:ring-blue-600"
                                />
                              </td>
                              <td className="px-4 py-3 font-medium text-gray-900">{c.tax_year}</td>
                              <td className="px-4 py-3 text-gray-700">Q{c.quarter}</td>
                              <td className="px-4 py-3 text-gray-700">{levyLabel(c.levy_type)}</td>
                              <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                                {formatCurrency(c.gross_amount)}
                              </td>
                              <td className="px-4 py-3 text-right text-orange-600 whitespace-nowrap">
                                {c.interest_accrued > 0 ? formatCurrency(c.interest_accrued) : '—'}
                              </td>
                              <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                                {formatCurrency(c.balance)}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                                {formatCurrency(c.total_due)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {selectedIds.size > 0 && (
                        <tfoot className="border-t-2 border-gray-200 bg-blue-50">
                          <tr>
                            <td colSpan={7} className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                              Selected Total ({selectedIds.size} charge{selectedIds.size !== 1 ? 's' : ''}):
                            </td>
                            <td className="px-4 py-3 text-right text-base font-bold text-blue-900 whitespace-nowrap">
                              {formatCurrency(selectedTotal)}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </>
              )}
            </Card>
          )}

          {/* Payment form */}
          {selectedIds.size > 0 && (
            <Card className="p-6">
              <h3 className="mb-4 text-base font-semibold text-gray-900">Payment Details</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Payer Name"
                  value={payerName}
                  onChange={setPayerName}
                  placeholder="Full name of person paying"
                  required
                />
                <Select
                  label="Payer Type"
                  value={payerType}
                  onChange={setPayerType}
                  options={PAYER_TYPES}
                />
                <Select
                  label="Payment Method"
                  value={paymentMethod}
                  onChange={setPaymentMethod}
                  options={PAYMENT_METHOD_OPTIONS}
                />
                <Input
                  label="Tender Amount (₱)"
                  type="number"
                  value={tenderInput}
                  onChange={setTenderInput}
                  placeholder="0.00"
                  required
                />
                <div className="sm:col-span-2">
                  <TextArea
                    label="Notes (optional)"
                    value={paymentNotes}
                    onChange={setPaymentNotes}
                    placeholder="Reference number, check details, etc."
                    rows={2}
                  />
                </div>
              </div>

              {/* Summary */}
              <div className="mt-5 rounded-lg bg-gray-50 p-4">
                <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-gray-500">Selected Total</p>
                    <p className="font-semibold text-gray-900">{formatCurrency(selectedTotal)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Tendered</p>
                    <p className="font-semibold text-gray-900">{formatCurrency(tenderCentavos)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Change Due</p>
                    <p className="font-semibold text-green-700">{formatCurrency(changeDue)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Charges Selected</p>
                    <p className="font-semibold text-gray-900">{selectedIds.size}</p>
                  </div>
                </div>
                {isUnderTender && (
                  <p className="mt-2 text-xs font-medium text-red-600">
                    Tender amount is less than the total due. Please increase the tender or deselect charges.
                  </p>
                )}
              </div>

              <div className="mt-5 flex justify-end gap-3">
                <Button variant="outline" onClick={() => { setSelectedIds(new Set()); }}>
                  Cancel
                </Button>
                <Button onClick={submitPayment} disabled={!canSubmit}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Accept Payment & Issue Receipt
                    </>
                  )}
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/*  Tab: Payment History                                                */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'history' && (
        <Card className="overflow-hidden">
          {loadingPayments ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-blue-700" />
            </div>
          ) : paymentError ? (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{paymentError}</span>
            </div>
          ) : payments.length === 0 ? (
            <EmptyState
              icon={<ReceiptIcon className="h-8 w-8" />}
              title="No Payments Yet"
              description="Payments collected will appear here. Click a payment to view its receipt."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Payer Name</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Receipt No.</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{p.payer_name}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                        {formatCurrency(p.total_allocated ?? 0)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{capitalize(p.payment_method)}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {formatDateTime(p.payment_date)}
                      </td>
                      <td className="px-4 py-3"><Badge status={p.status} /></td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">
                        {p.receipt?.receipt_number ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openReceiptModal(p)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
                        >
                          <ReceiptIcon className="h-3.5 w-3.5" />
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/*  Tab: Cash Session                                                   */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'session' && (
        <div className="space-y-4">
          {sessionError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{sessionError}</span>
            </div>
          )}

          {loadingSession ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-blue-700" />
            </div>
          ) : cashSession ? (
            <Card className="p-6">
              <div className="flex items-center justify-between border-b border-gray-200 pb-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-50 p-3 text-blue-700">
                    <Unlock className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">Open Cash Session</h3>
                    <p className="text-sm text-gray-500">{cashSession.session_number}</p>
                  </div>
                </div>
                <Badge status="open" />
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-xs text-gray-500">Opened At</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">{formatDateTime(cashSession.opened_at)}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-xs text-gray-500">Total Collected</p>
                  <p className="mt-1 text-lg font-bold text-green-700">
                    {formatCurrency(cashSession.total_collected ?? 0)}
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-xs text-gray-500">Total Receipts</p>
                  <p className="mt-1 text-lg font-bold text-gray-900">{cashSession.total_receipts ?? 0}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-xs text-gray-500">Opening Balance</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {formatCurrency(cashSession.opening_balance ?? 0)}
                  </p>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <Button variant="danger" onClick={closeSession} disabled={closingSession}>
                  {closingSession ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Closing...
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4" />
                      Close Session
                    </>
                  )}
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="p-6">
              <EmptyState
                icon={<Wallet className="h-8 w-8" />}
                title="No Open Cash Session"
                description="Open a new cash session to start collecting payments. All payments will be recorded against the active session."
                action={
                  <Button onClick={openSession}>
                    <Unlock className="h-4 w-4" />
                    Open New Session
                  </Button>
                }
              />
            </Card>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/*  Receipt Modal                                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={!!receiptPayment}
        onClose={() => setReceiptPayment(null)}
        title={`Official Receipt — ${receiptPayment?.receipt?.receipt_number ?? 'Pending'}`}
        size="lg"
      >
        {receiptLoading || !receiptPayment ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-blue-700" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Header */}
            <div className="rounded-lg bg-blue-50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ReceiptIcon className="h-5 w-5 text-blue-700" />
                  <span className="text-sm font-bold text-blue-900">Real Property Tax Receipt</span>
                </div>
                <Badge status={receiptPayment.status} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500">Receipt Number</p>
                  <p className="font-mono font-semibold text-gray-900">
                    {receiptPayment.receipt?.receipt_number ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Date Issued</p>
                  <p className="font-medium text-gray-900">
                    {formatDateTime(receiptPayment.receipt?.issued_date ?? receiptPayment.payment_date)}
                  </p>
                </div>
              </div>
            </div>

            {/* Payer info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500">Payer Name</p>
                <p className="text-sm font-medium text-gray-900">{receiptPayment.payer_name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Payer Type</p>
                <p className="text-sm font-medium text-gray-900">{capitalize(receiptPayment.payer_type)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Payment Method</p>
                <p className="text-sm font-medium text-gray-900">{capitalize(receiptPayment.payment_method)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Collected By</p>
                <p className="text-sm font-medium text-gray-900">{staffUser?.full_name ?? '—'}</p>
              </div>
            </div>

            {/* Allocations */}
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2">Charge</th>
                    <th className="px-4 py-2 text-right">Principal</th>
                    <th className="px-4 py-2 text-right">Interest</th>
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(receiptPayment.allocations ?? []).map((a: PaymentAllocation | AllocationWithCharge) => {
                    const alloc = a as AllocationWithCharge;
                    const charge = alloc.tax_charge;
                    return (
                      <tr key={a.id}>
                        <td className="px-4 py-2 text-gray-700">
                          {charge
                            ? `CY ${charge.tax_year} · Q${charge.quarter} · ${levyLabel(charge.levy_type)}`
                            : '—'}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-700 whitespace-nowrap">
                          {formatCurrency(a.principal_amount ?? 0)}
                        </td>
                        <td className="px-4 py-2 text-right text-orange-600 whitespace-nowrap">
                          {a.interest_amount > 0 ? formatCurrency(a.interest_amount) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900 whitespace-nowrap">
                          {formatCurrency(a.allocated_amount ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                  {(receiptPayment.allocations ?? []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">
                        No allocation details available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="space-y-2 rounded-lg bg-gray-50 p-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Total Allocated</span>
                <span className="font-semibold text-gray-900">
                  {formatCurrency(receiptPayment.total_allocated ?? 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Tender Amount</span>
                <span className="text-gray-900">{formatCurrency(receiptPayment.tender_amount ?? 0)}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-2 text-sm">
                <span className="font-semibold text-gray-700">Change Due</span>
                <span className="font-bold text-green-700">
                  {formatCurrency(receiptPayment.change_amount ?? 0)}
                </span>
              </div>
            </div>

            {receiptPayment.notes && (
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500">Notes</p>
                <p className="mt-1 text-sm text-gray-700">{receiptPayment.notes}</p>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                Print Receipt
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
