export const STAFF_ROLES = [
  { code: 'admin', name: 'Administrator', description: 'Full system access' },
  { code: 'assessor', name: 'Municipal Assessor', description: 'Property registry and assessment' },
  { code: 'treasurer', name: 'Municipal Treasurer', description: 'Billing and collection supervision' },
  { code: 'cashier', name: 'Cashier', description: 'Payment collection' },
  { code: 'accountant', name: 'Municipal Accountant', description: 'Accounting and reconciliation' },
  { code: 'executive', name: 'Mayor / Executive', description: 'Read-only dashboards' },
] as const;

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['dashboard', 'properties', 'assessments', 'billing', 'collection', 'reconciliation', 'cases', 'reports', 'configuration', 'user_management'],
  assessor: ['dashboard', 'properties', 'assessments', 'reports', 'cases'],
  treasurer: ['dashboard', 'properties', 'billing', 'collection', 'reconciliation', 'reports', 'cases'],
  cashier: ['dashboard', 'collection'],
  accountant: ['dashboard', 'reconciliation', 'reports'],
  executive: ['dashboard', 'reports'],
};

export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { key: 'properties', label: 'Property Registry', icon: 'Building2' },
  { key: 'assessments', label: 'Assessment & Valuation', icon: 'ClipboardCheck' },
  { key: 'billing', label: 'Billing & Tax Computation', icon: 'Calculator' },
  { key: 'collection', label: 'Collection & Payment', icon: 'HandCoins' },
  { key: 'reconciliation', label: 'Revenue Sharing', icon: 'Scale' },
  { key: 'cases', label: 'Cases & Compliance', icon: 'Gavel' },
  { key: 'reports', label: 'Reports', icon: 'FileText' },
  { key: 'configuration', label: 'System Configuration', icon: 'Settings' },
  { key: 'user_management', label: 'User Management', icon: 'Users' },
] as const;

export const PROPERTY_CLASSIFICATIONS = [
  'residential', 'agricultural', 'commercial', 'industrial', 'mineral', 'timberland', 'special',
] as const;

export const UNIT_TYPES = ['land', 'building', 'machinery'] as const;

export const LEVY_TYPES = [
  { code: 'basic', name: 'Basic RPT' },
  { code: 'sef', name: 'SEF Tax' },
  { code: 'idle_land', name: 'Idle Land Tax' },
  { code: 'special_levy', name: 'Special Levy' },
] as const;

export const CASE_TYPES = [
  { code: 'assessment_appeal', name: 'Assessment Appeal' },
  { code: 'payment_protest', name: 'Payment Under Protest' },
  { code: 'refund_claim', name: 'Refund / Credit Claim' },
  { code: 'delinquency_enforcement', name: 'Delinquency Enforcement' },
] as const;

export const PAYMENT_METHODS = [
  { code: 'cash', name: 'Cash' },
  { code: 'check', name: 'Check' },
  { code: 'bank_transfer', name: 'Bank Transfer' },
  { code: 'online', name: 'Online' },
] as const;

export const INTEREST_RATE_MONTHLY = 0.02;
export const INTEREST_MAX_MONTHS = 36;
export const DISCOUNT_MAX_PERCENT = 20;
export const RA12001_CAP_PERCENT = 6;

export const REVENUE_SHARES = {
  basic: { province: 0.35, municipality: 0.40, barangay: 0.25 },
  sef: { sef_province: 0.50, sef_municipality: 0.50 },
  idle_land: { province: 0.35, municipality: 0.40, barangay: 0.25 },
  special_levy: {},
};

export const QUARTERLY_DUE_DATES = {
  1: 'March 31',
  2: 'June 30',
  3: 'September 30',
  4: 'December 31',
};

export const MUNICIPALITY_NAME = 'Municipality of Lopez';
export const PROVINCE_NAME = 'Quezon Province';
export const SYSTEM_NAME = 'Real Property Tax System';

export const DEMO_STAFF_ACCOUNTS = [
  { email: 'admin@lopez.gov.ph', password: 'Admin123!', role: 'Administrator' },
  { email: 'assessor@lopez.gov.ph', password: 'Assessor123!', role: 'Municipal Assessor' },
  { email: 'treasurer@lopez.gov.ph', password: 'Treasurer123!', role: 'Municipal Treasurer' },
  { email: 'cashier@lopez.gov.ph', password: 'Cashier123!', role: 'Cashier' },
  { email: 'accountant@lopez.gov.ph', password: 'Accountant123!', role: 'Municipal Accountant' },
  { email: 'mayor@lopez.gov.ph', password: 'Mayor123!', role: 'Mayor / Executive' },
];

export const DEMO_TAXPAYER_ACCOUNTS = [
  { taxpayer_id: 'TP-2026-0001', password: 'taxpayer123', name: 'Juan dela Cruz Santos' },
  { taxpayer_id: 'TP-2026-0002', password: 'taxpayer123', name: 'Lopez Trading Corporation' },
];
