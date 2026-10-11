import { type ReactNode, useState } from 'react';
import {
  LayoutDashboard, Building2, ClipboardCheck, Calculator, HandCoins,
  Scale, Gavel, FileText, Settings, Users, LogOut, Menu, X,
  ChevronDown, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { NAV_ITEMS, MUNICIPALITY_NAME, SYSTEM_NAME } from '@/lib/constants';

const ICON_MAP: Record<string, typeof LayoutDashboard> = {
  LayoutDashboard, Building2, ClipboardCheck, Calculator, HandCoins,
  Scale, Gavel, FileText, Settings, Users,
};

interface AppLayoutProps {
  children: ReactNode;
  activeKey: string;
  onNavigate: (key: string) => void;
}

export function AppLayout({ children, activeKey, onNavigate }: AppLayoutProps) {
  const { staffUser, staffRole, staffOffice, signOut, hasPermission } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleNavItems = NAV_ITEMS.filter((item) => hasPermission(item.key));
  const activeItem = NAV_ITEMS.find((item) => item.key === activeKey);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-slate-800 text-white transition-transform lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex h-16 items-center gap-3 border-b border-slate-700 px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">RPT System</p>
            <p className="truncate text-xs text-slate-400">Lopez, Quezon</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto rounded p-1 text-slate-400 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {visibleNavItems.map((item) => {
            const Icon = ICON_MAP[item.icon] || LayoutDashboard;
            const isActive = activeKey === item.key;
            return (
              <button
                key={item.key}
                onClick={() => {
                  onNavigate(item.key);
                  setSidebarOpen(false);
                }}
                className={`
                  flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                  ${isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}
                `}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-700 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-600 text-sm font-bold">
              {staffUser?.full_name?.charAt(0) || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{staffUser?.full_name}</p>
              <p className="truncate text-xs text-slate-400">{staffRole?.name}</p>
            </div>
            <button
              onClick={signOut}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-gray-200 bg-white px-4 lg:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h2 className="text-lg font-semibold text-gray-900 flex-1">
            {activeItem?.label || 'Dashboard'}
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg bg-yellow-50 px-3 py-1.5">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <span className="text-xs font-medium text-yellow-800">Pending Certification</span>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">{staffUser?.full_name}</p>
                <p className="text-xs text-gray-500">{staffOffice?.name}</p>
              </div>
              <ChevronDown className="h-4 w-4 text-gray-400" />
            </div>
          </div>
        </header>

        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
