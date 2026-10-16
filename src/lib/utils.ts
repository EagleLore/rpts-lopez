export function formatCurrency(centavos: number): string {
  const pesos = centavos / 100;
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pesos);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-PH').format(value);
}

export function formatDate(date: string | Date | null): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date | null): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    approved: 'bg-green-100 text-green-800',
    paid: 'bg-green-100 text-green-800',
    closed: 'bg-green-100 text-green-800',
    decided: 'bg-green-100 text-green-800',
    acknowledged: 'bg-green-100 text-green-800',
    reconciled: 'bg-green-100 text-green-800',
    issued: 'bg-blue-100 text-blue-800',
    confirmed: 'bg-blue-100 text-blue-800',
    receipted: 'bg-blue-100 text-blue-800',
    settled: 'bg-blue-100 text-blue-800',
    pending: 'bg-yellow-100 text-yellow-800',
    pending_review: 'bg-yellow-100 text-yellow-800',
    draft: 'bg-gray-100 text-gray-600',
    filed: 'bg-yellow-100 text-yellow-800',
    under_review: 'bg-yellow-100 text-yellow-800',
    prepared: 'bg-blue-100 text-blue-800',
    submitted: 'bg-blue-100 text-blue-800',
    unpaid: 'bg-red-100 text-red-800',
    overdue: 'bg-red-100 text-red-800',
    cancelled: 'bg-red-100 text-red-800',
    reversed: 'bg-red-100 text-red-800',
    failed: 'bg-red-100 text-red-800',
    dismissed: 'bg-red-100 text-red-800',
    appealed: 'bg-orange-100 text-orange-800',
    partially_paid: 'bg-yellow-100 text-yellow-800',
    open: 'bg-blue-100 text-blue-800',
    retired: 'bg-gray-100 text-gray-600',
    transferred: 'bg-gray-100 text-gray-600',
    superseded: 'bg-gray-100 text-gray-600',
    in_force: 'bg-green-100 text-green-800',
    certified: 'bg-green-100 text-green-800',
    published: 'bg-blue-100 text-blue-800',
    expired: 'bg-red-100 text-red-800',
    inactive: 'bg-gray-100 text-gray-600',
  };
  return colors[status] || 'bg-gray-100 text-gray-600';
}

export function computeInterest(
  unpaidPrincipal: number,
  dueDate: string,
  asOfDate: Date = new Date()
): number {
  const due = new Date(dueDate);
  if (asOfDate <= due) return 0;

  const monthsOverdue =
    (asOfDate.getFullYear() - due.getFullYear()) * 12 +
    (asOfDate.getMonth() - due.getMonth());
  const isFractionalMonth = asOfDate.getDate() > due.getDate();
  const chargeableMonths = Math.min(
    monthsOverdue + (isFractionalMonth ? 1 : 0),
    36
  );

  if (chargeableMonths <= 0) return 0;
  return Math.round(unpaidPrincipal * 0.02 * chargeableMonths);
}

export function computeAssessedValue(
  marketValue: number,
  assessmentLevelPercent: number
): number {
  return Math.round((marketValue * assessmentLevelPercent) / 100);
}

export function computeTax(
  assessedValue: number,
  ratePercent: number
): number {
  return Math.round((assessedValue * ratePercent) / 100);
}

export function generateCaseNumber(caseType: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const prefix = caseType === 'assessment_appeal' ? 'AAP'
    : caseType === 'payment_protest' ? 'PRO'
    : caseType === 'refund_claim' ? 'REF'
    : 'ENF';
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}-${year}-${random}`;
}
