import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/wordmark";
import { useAuth } from "@/store/auth";

type Mode = "login" | "register";

export function AuthPage() {
  const { signIn, signUp, loading, configured } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (!configured) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Card>
          <CardHeader>
            <CardTitle className="text-ink">الاتصال بخادم Supabase غير مهيأ</CardTitle>
            <CardDescription>
              انسخ <code className="rounded bg-secondary px-1">.env.example</code> إلى{" "}
              <code className="rounded bg-secondary px-1">.env.local</code> وضع مفاتيح مشروعك ثم
              أعد تشغيل الخادم.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/">
              <Button variant="outline">العودة للرئيسية</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setInfo(null);
    try {
      if (mode === "login") {
        await signIn(email, password);
        navigate("/", { replace: true });
      } else {
        if (displayName.trim().length < 2) {
          setFormError("الاسم يجب ألا يقل عن حرفين.");
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
          setFormError("صيغة البريد الإلكتروني غير صحيحة. مثال: name@example.com");
          return;
        }
        if (password.length < 8) {
          setFormError("كلمة المرور ضعيفة. استخدم 8 أحرف على الأقل.");
          return;
        }
        await signUp(email, password, displayName);
        // If email confirmation is on, user stays here with info.
        setInfo(
          "تم إنشاء الحساب. إن كان تأكيد البريد مفعّلًا فتح رسالة التأكيد ثم سجّل الدخول.",
        );
        setMode("login");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "حدث خطأ.");
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12 md:py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <Wordmark />
        <p className="text-sm text-ink-muted">
          {mode === "login" ? "سجّل الدخول لمتابعة استخدام بينا" : "أنشئ حسابك في بينا"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-ink">
            {mode === "login" ? (
              <>
                <LogIn className="size-5 text-success" />
                تسجيل الدخول
              </>
            ) : (
              <>
                <UserPlus className="size-5 text-success" />
                حساب جديد
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "register" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">الاسم المعروض</Label>
                <Input
                  id="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="مثال: أحمد سمير"
                  required
                  minLength={2}
                  maxLength={80}
                  autoComplete="name"
                />
              </div>
            )}
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
            <div className="space-y-1.5">
              <Label htmlFor="password">كلمة المرور</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8 أحرف على الأقل"
                  required
                  minLength={8}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
            </div>

            {mode === "login" && (
              <div className="text-left">
                <Link
                  to="/reset-password"
                  className="text-xs font-medium text-brand hover:underline"
                >
                  نسيت كلمة المرور؟
                </Link>
              </div>
            )}

            {formError && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {formError}
              </p>
            )}
            {info && (
              <p className="rounded-lg border border-warn-line bg-warn-soft p-3 text-sm leading-6 text-gold-deep">
                {info}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              {mode === "login" ? "دخول" : "إنشاء الحساب"}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm text-ink-muted">
            {mode === "login" ? (
              <button
                type="button"
                onClick={() => {
                  setMode("register");
                  setFormError(null);
                }}
                className="rounded font-medium text-success-ink hover:text-success-hover outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                ليس لديك حساب؟ أنشئ حسابًا
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setFormError(null);
                }}
                className="rounded font-medium text-success-ink hover:text-success-hover outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                لديك حساب بالفعل؟ سجّل الدخول
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
