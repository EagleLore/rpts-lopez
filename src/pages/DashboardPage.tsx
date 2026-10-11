import { useState, useEffect } from 'react';
import {
  Building2, Calculator, HandCoins, AlertTriangle,
  TrendingUp, FileText, Gavel, Clock,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, StatCard, Badge, PageHeader } from '@/components/ui';
import { formatCurrency, formatNumber, formatDate } from '@/lib/utils';

interface DashboardStats {
  totalProperties: number;
  totalAssessments: number;
  totalBilled: number;
  totalCollected: number;
  totalArrears: number;
  pendingApprovals: number;
  pendingCases: number;
  upcomingDeadlines: number;
  recentPayments: Array<{
    id: string;
    payer_name: string;
    tender_amount: number;
    payment_date: string;
    status: string;
  }>;
  overdueCharges: Array<{
    id: string;
    tax_year: number;
    quarter: number;
    levy_type: string;
    balance: number;
    due_date: string;
    property?: { pin: string | null; tax_declaration_number: string | null };
  }>;
}

export function DashboardPage() {
  const { staffRole } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      const [properties, assessments, charges, payments, cases, calendar, recentPaymentsRes] = await Promise.all([
        supabase.from('properties').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('assessments').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
        supabase.from('tax_charges').select('gross_amount, paid_amount, balance, due_date, status'),
        supabase.from('payments').select('tender_amount, payment_date, status').eq('status', 'confirmed'),
        supabase.from('cases').select('id', { count: 'exact', head: true }).in('status', ['filed', 'pending', 'under_review']),
        supabase.from('compliance_calendar').select('id, deadline, status').gte('deadline', new Date().toISOString().split('T')[0]).order('deadline', { ascending: true }).limit(5),
        supabase.from('payments').select(`
          id, payer_name, tender_amount, payment_date, status,
          receipts!inner(receipt_number)
        `).order('payment_date', { ascending: false }).limit(5),
      ]);

      const totalBilled = charges.data?.reduce((sum, c) => sum + (c.gross_amount || 0), 0) || 0;
      const totalCollected = charges.data?.reduce((sum, c) => sum + (c.paid_amount || 0), 0) || 0;
      const totalArrears = charges.data?.reduce((sum, c) => sum + (c.balance || 0), 0) || 0;
      const pendingApprovals = assessments.data?.length || 0;

      const overdueChargesRes = await supabase
        .from('tax_charges')
        .select(`
          id, tax_year, quarter, levy_type, balance, due_date, status,
          property:properties(pin, tax_declaration_number)
        `)
        .in('status', ['unpaid', 'partially_paid'])
        .lt('due_date', new Date().toISOString().split('T')[0])
        .order('due_date', { ascending: true })
        .limit(5);

      setStats({
        totalProperties: properties.count || 0,
        totalAssessments: assessments.count || 0,
        totalBilled,
        totalCollected,
        totalArrears,
        pendingApprovals,
        pendingCases: cases.count || 0,
        upcomingDeadlines: calendar.data?.length || 0,
        recentPayments: recentPaymentsRes.data?.map((p: Record<string, unknown>) => ({
          id: p.id as string,
          payer_name: p.payer_name as string,
          tender_amount: p.tender_amount as number,
          payment_date: p.payment_date as string,
          status: p.status as string,
        })) || [],
        overdueCharges: overdueChargesRes.data?.map((c: Record<string, unknown>) => ({
          id: c.id as string,
          tax_year: c.tax_year as number,
          quarter: c.quarter as number,
          levy_type: c.levy_type as string,
          balance: c.balance as number,
          due_date: c.due_date as string,
          property: c.property as { pin: string | null; tax_declaration_number: string | null },
        })) || [],
      });
      setLoading(false);
    }
    loadStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-700" />
      </div>
    );
  }

  const collectionEfficiency = stats && stats.totalBilled > 0
    ? ((stats.totalCollected / stats.totalBilled) * 100).toFixed(1)
    : '0.0';

  return (
    <div>
      <PageHeader
        title={`Welcome, ${staffRole?.name || 'Staff'}`}
        description="Overview of real property tax operations for the Municipality of Lopez, Quezon"
      />

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-yellow-200 bg-yellow-50 p-4">
        <AlertTriangle className="h-5 w-5 flex-shrink-0 text-yellow-600 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-yellow-900">Pre-Certification Mode</p>
          <p className="text-sm text-yellow-800 mt-0.5">
            Tax rates, assessment levels, and valuation schedules are pre-loaded with illustrative values
            pending certification by Quezon Province. Do not use for official billing until certified.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Registered Properties"
          value={formatNumber(stats?.totalProperties || 0)}
          icon={<Building2 className="h-6 w-6" />}
          color="blue"
        />
        <StatCard
          label="Total Annual Billed"
          value={formatCurrency(stats?.totalBilled || 0)}
          icon={<Calculator className="h-6 w-6" />}
          color="teal"
        />
        <StatCard
          label="Total Collected"
          value={formatCurrency(stats?.totalCollected || 0)}
          icon={<HandCoins className="h-6 w-6" />}
          color="green"
          trend={`${collectionEfficiency}% collection efficiency`}
        />
        <StatCard
          label="Outstanding Arrears"
          value={formatCurrency(stats?.totalArrears || 0)}
          icon={<TrendingUp className="h-6 w-6" />}
          color="red"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Approved Assessments"
          value={formatNumber(stats?.totalAssessments || 0)}
          icon={<ClipboardCheckMini />}
          color="purple"
        />
        <StatCard
          label="Pending Cases"
          value={formatNumber(stats?.pendingCases || 0)}
          icon={<Gavel className="h-6 w-6" />}
          color="orange"
        />
        <StatCard
          label="Upcoming Deadlines"
          value={formatNumber(stats?.upcomingDeadlines || 0)}
          icon={<Clock className="h-6 w-6" />}
          color="yellow"
        />
        <StatCard
          label="Recent Payments"
          value={formatNumber(stats?.recentPayments.length || 0)}
          icon={<FileText className="h-6 w-6" />}
          color="blue"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Payments</h3>
          {stats?.recentPayments.length ? (
            <div className="space-y-3">
              {stats.recentPayments.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-gray-100 pb-3 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{p.payer_name}</p>
                    <p className="text-xs text-gray-500">{formatDate(p.payment_date)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">{formatCurrency(p.tender_amount)}</p>
                    <Badge status={p.status} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-8 text-center">No recent payments</p>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Overdue Charges</h3>
          {stats?.overdueCharges.length ? (
            <div className="space-y-3">
              {stats.overdueCharges.map((c) => (
                <div key={c.id} className="flex items-center justify-between border-b border-gray-100 pb-3 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {c.property?.pin || c.property?.tax_declaration_number || '—'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {c.tax_year} Q{c.quarter} • {c.levy_type.replace(/_/g, ' ')} • Due {formatDate(c.due_date)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-red-600">{formatCurrency(c.balance)}</p>
                    <Badge status="overdue" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-8 text-center">No overdue charges</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function ClipboardCheckMini() {
  return (
    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}
