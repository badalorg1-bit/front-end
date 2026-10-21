import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured, toArabicError } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

interface AuthContextValue {
  ready: boolean;
  configured: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: { display_name?: string; city?: string }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(!isSupabaseConfigured);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId || !isSupabaseConfigured) {
      setProfile(null);
      return;
    }
    const { data, error: err } = await getSupabase()
      .from("profiles")
      .select("id, display_name, city, avatar_url, created_at, role, is_banned")
      .eq("id", userId)
      .maybeSingle();
    if (err) {
      setProfile(null);
      return;
    }
    setProfile(data);
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile(session?.user?.id);
  }, [loadProfile, session?.user?.id]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    let cancelled = false;
    const sb = getSupabase();

    sb.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      void loadProfile(data.session?.user?.id).finally(() => {
        if (!cancelled) setReady(true);
      });
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void loadProfile(next?.user?.id);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const { error: err } = await getSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) throw new Error(toArabicError(err));
    } catch (e) {
      setError(e instanceof Error ? e.message : toArabicError(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await getSupabase().auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: displayName.trim() } },
      });
      if (err) throw new Error(toArabicError(err));
      // If email confirmation is disabled, session is returned immediately.
      if (data.session) {
        setSession(data.session);
        await loadProfile(data.user?.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : toArabicError(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [loadProfile]);

  const resetPassword = useCallback(async (email: string) => {
    setLoading(true);
    setError(null);
    try {
      const { error: err } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/reset-password`,
      });
      if (err) throw new Error(toArabicError(err));
    } catch (e) {
      setError(e instanceof Error ? e.message : toArabicError(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    setLoading(true);
    setError(null);
    try {
      const { error: err } = await getSupabase().auth.updateUser({ password: newPassword });
      if (err) throw new Error(toArabicError(err));
    } catch (e) {
      setError(e instanceof Error ? e.message : toArabicError(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    await getSupabase().auth.signOut();
    setProfile(null);
  }, []);

  const updateProfile = useCallback(
    async (patch: { display_name?: string; city?: string }) => {
      if (!session?.user?.id) throw new Error("يجب تسجيل الدخول أولًا.");
      setLoading(true);
      setError(null);
      try {
        const { error: err } = await getSupabase()
          .from("profiles")
          .update(patch)
          .eq("id", session.user.id);
        if (err) throw new Error(toArabicError(err));
        await loadProfile(session.user.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : toArabicError(e));
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [loadProfile, session?.user?.id],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      configured: isSupabaseConfigured,
      session,
      user: session?.user ?? null,
      profile,
      loading,
      error,
      signIn,
      signUp,
      resetPassword,
      updatePassword,
      signOut,
      refreshProfile,
      updateProfile,
    }),
    [ready, session, profile, loading, error, signIn, signUp, resetPassword, updatePassword, signOut, refreshProfile, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
