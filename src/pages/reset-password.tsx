import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/wordmark";
import { useAuth } from "@/store/auth";
import { getSupabase } from "@/lib/supabase";

/**
 * Handles both modes:
 * - `forgot`: user enters email → receives reset link (calls resetPasswordForEmail)
 * - `recovery`: user arrived via the emailed link (session exists) → sets a new password
 */
export function ResetPasswordPage() {
  const { session, resetPassword, updatePassword, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"forgot" | "recovery">(session ? "recovery" : "forgot");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Detect recovery link (PASSWORD_RECOVERY event / hash token).
  useEffect(() => {
    let cancelled = false;
    const sb = getSupabase();
    // Supabase stores the recovery session once the link is followed.
    sb.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) setMode("recovery");
    });
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (!cancelled && event === "PASSWORD_RECOVERY") setMode("recovery");
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const onForgot = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError("صيغة البريد الإلكتروني غير صحيحة.");
      return;
    }
    try {
      await resetPassword(email);
      setInfo("تم إرسال رابط استعادة كلمة المرور إلى بريدك. تحقق من صندوق الوارد.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إرسال الرابط.");
    }
  };

  const onRecovery = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("كلمة المرور ضعيفة. استخدم 8 أحرف على الأقل.");
      return;
    }
    if (password !== confirm) {
      setError("كلمتا المرور غير متطابقتين.");
      return;
    }
    try {
      await updatePassword(password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحديث كلمة المرور.");
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12 md:py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <Wordmark />
        <p className="text-sm text-ink-muted">استعادة كلمة المرور</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-ink">
            {mode === "forgot" ? (
              <>
                <Mail className="size-5 text-success" />
                نسيت كلمة المرور
              </>
            ) : (
              <>
                <KeyRound className="size-5 text-success" />
                تعيين كلمة مرور جديدة
              </>
            )}
          </CardTitle>
          <CardDescription>
            {mode === "forgot"
              ? "أدخل بريدك الإلكتروني وسنرسل لك رابطًا لاستعادة كلمة المرور."
              : "اختر كلمة مرور جديدة لحسابك."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mode === "forgot" ? (
            <form onSubmit={onForgot} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">البريد الإلكتروني</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  dir="ltr"
                />
              </div>
              {error && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {error}
                </p>
              )}
              {info && (
                <p className="flex items-start gap-2 rounded-lg border border-success/30 bg-success-soft p-3 text-sm leading-6 text-success-ink">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  {info}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="size-4 animate-spin" />}
                إرسال رابط الاستعادة
              </Button>
            </form>
          ) : (
            <form onSubmit={onRecovery} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">كلمة المرور الجديدة</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8 أحرف على الأقل"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">تأكيد كلمة المرور</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="أعد إدخال كلمة المرور"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              {error && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="size-4 animate-spin" />}
                حفظ كلمة المرور الجديدة
              </Button>
            </form>
          )}

          <div className="mt-4 text-center text-sm text-ink-muted">
            <Link
              to="/auth"
              className="rounded font-medium text-success-ink hover:text-success-hover outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              العودة لتسجيل الدخول
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
