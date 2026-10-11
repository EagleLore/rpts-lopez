import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { StaffUser, TaxpayerUser, StaffRole, Office } from '@/lib/types';

interface AuthContextType {
  staffUser: StaffUser | null;
  taxpayer: TaxpayerUser | null;
  loading: boolean;
  staffRole: StaffRole | null;
  staffOffice: Office | null;
  signInStaff: (email: string, password: string) => Promise<{ error: string | null }>;
  signInTaxpayer: (taxpayerId: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [taxpayer, setTaxpayer] = useState<TaxpayerUser | null>(null);
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null);
  const [staffOffice, setStaffOffice] = useState<Office | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      const { data: { session } } = await supabase.auth.getSession();

      if (mounted && session?.user) {
        await loadStaffUser(session.user.id);
      }

      const storedTaxpayer = localStorage.getItem('taxpayer_session');
      if (mounted && storedTaxpayer) {
        try {
          setTaxpayer(JSON.parse(storedTaxpayer));
        } catch {
          localStorage.removeItem('taxpayer_session');
        }
      }

      if (mounted) setLoading(false);
    }

    loadSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        if (session?.user) {
          await loadStaffUser(session.user.id);
        } else {
          setStaffUser(null);
          setStaffRole(null);
          setStaffOffice(null);
        }
        if (mounted) setLoading(false);
      })();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function loadStaffUser(authId: string) {
    const { data, error } = await supabase
      .from('staff_users')
      .select(`
        *,
        role:staff_roles(*),
        office:offices(*)
      `)
      .eq('auth_id', authId)
      .eq('is_active', true)
      .maybeSingle();

    if (data && !error) {
      setStaffUser(data);
      setStaffRole(data.role);
      setStaffOffice(data.office);
    } else {
      setStaffUser(null);
      setStaffRole(null);
      setStaffOffice(null);
    }
  }

  async function signInStaff(email: string, password: string): Promise<{ error: string | null }> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }

  async function signInTaxpayer(taxpayerId: string, password: string): Promise<{ error: string | null }> {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/taxpayer-auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'login', taxpayer_id: taxpayerId, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        return { error: data.error || 'Login failed' };
      }

      const data = await response.json();
      if (data.taxpayer) {
        localStorage.setItem('taxpayer_session', JSON.stringify(data.taxpayer));
        setTaxpayer(data.taxpayer);
        await supabase.auth.signOut();
        return { error: null };
      }
      return { error: 'Login failed' };
    } catch {
      return { error: 'Network error. Please try again.' };
    }
  }

  async function signOut(): Promise<void> {
    await supabase.auth.signOut();
    localStorage.removeItem('taxpayer_session');
    setStaffUser(null);
    setTaxpayer(null);
    setStaffRole(null);
    setStaffOffice(null);
  }

  function hasPermission(permission: string): boolean {
    if (!staffRole) return false;
    return staffRole.permissions.includes(permission);
  }

  return (
    <AuthContext.Provider value={{
      staffUser, taxpayer, loading, staffRole, staffOffice,
      signInStaff, signInTaxpayer, signOut, hasPermission,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
