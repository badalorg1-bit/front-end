import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Camera, CheckCircle2, Landmark, Loader2, Plus, ShieldCheck, Trash2, User, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingSkeleton } from "@/components/states";
import { Avatar } from "@/components/avatar";
import { deletePaymentQr, getMyPaymentProfile, getUserPublicProfile, getWalletSummary, savePaymentProfile, uploadAvatar, uploadPaymentQr } from "@/lib/api";
import { getPaymentQrPublicUrl, validateImageFile } from "@/lib/supabase";
import { fmtEGP, fmtShortDate } from "@/lib/format";
import type { WalletSummary } from "@/lib/types";

/** Owner wallet tab: payment identity shown to counterparties after acceptance. */
export function WalletTab({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [walletName, setWalletName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [note, setNote] = useState("");
  const [qrPath, setQrPath] = useState<string | null>(null);
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    let cancelled = false;
    getWalletSummary()
      .then((w) => {
        if (!cancelled) setWallet(w);
      })
      .catch(() => {
        if (!cancelled) setWallet(null);
      });
    getMyPaymentProfile()
      .then(() => {})
      .catch(() => {});
    // load profile for avatar
    getUserPublicProfile(userId)
      .then((p) => {
        if (!cancelled && p) {
          setAvatarPath(p.avatar_url);
          setDisplayName(p.display_name);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    getMyPaymentProfile()
      .then((p) => {
        if (cancelled) return;
        setWalletName(p.wallet_name ?? "");
        setInstagram(p.instagram_handle ?? "");
        setWhatsapp(p.whatsapp_phone ?? "");
        setNote(p.payment_note ?? "");
        setQrPath(p.payment_qr_path ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "تعذر تحميل بيانات المحفظة.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (qrPreview) URL.revokeObjectURL(qrPreview);
    };
  }, [qrPreview]);

  const onFile = (f: File | null) => {
    if (!f) return;
    const err = validateImageFile(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSaved(false);
    setQrFile(f);
    if (qrPreview) URL.revokeObjectURL(qrPreview);
    setQrPreview(URL.createObjectURL(f));
  };

  const removeQr = () => {
    setQrFile(null);
    if (qrPreview) URL.revokeObjectURL(qrPreview);
    setQrPreview(null);
    setQrPath(null);
    setSaved(false);
  };

  const onAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const err = validateImageFile(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setAvatarFile(f);
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(URL.createObjectURL(f));
  };

  const saveAvatar = async () => {
    if (!avatarFile) return;
    setAvatarBusy(true);
    setError(null);
    try {
      const path = await uploadAvatar(userId, avatarFile);
      setAvatarPath(path);
      setAvatarFile(null);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر رفع الصورة.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (walletName.trim().length < 2) {
      setError("اسم المحفظة قصير جدًا (حرفان على الأقل).");
      return;
    }
    setSaving(true);
    try {
      let nextPath = qrPath;
      if (qrFile) {
        nextPath = await uploadPaymentQr(userId, qrFile);
        if (qrPath && qrPath !== nextPath) {
          try {
            await deletePaymentQr(qrPath);
          } catch {
            /* old object cleanup is best-effort */
          }
        }
      }
      await savePaymentProfile({
        wallet_name: walletName,
        payment_qr_path: nextPath,
        instagram_handle: instagram,
        whatsapp_phone: whatsapp,
        payment_note: note,
      });
      setQrPath(nextPath);
      setQrFile(null);
      if (qrPreview) URL.revokeObjectURL(qrPreview);
      setQrPreview(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ المحفظة.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingSkeleton />;
  }

  const currentQr = qrPreview ?? (qrPath ? getPaymentQrPublicUrl(qrPath) : "");

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-ink">
          <Wallet className="size-5 text-success" />
          محفظتي
        </CardTitle>
        <CardDescription>
          اضبط بيانات الدفع التي تظهر للمستأجر أو المشتري فور قبول طلبه — مباشرة بين الطرفين.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Avatar section */}
        <div className="mb-4 rounded-lg border border-line bg-secondary/40 p-3.5">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <User className="size-4 text-brand" />
            الصورة الشخصية
          </p>
          <div className="flex items-center gap-4">
            <Avatar
              src={avatarPreview ? avatarPreview : avatarPath}
              name={displayName || "مستخدم"}
              size="lg"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <input
                id="avatar-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={onAvatarChange}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => document.getElementById("avatar-input")?.click()}
                >
                  <Camera className="size-4" />
                  {avatarPath ? "تغيير الصورة" : "رفع صورة"}
                </Button>
                {avatarFile && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={avatarBusy}
                    onClick={() => void saveAvatar()}
                  >
                    {avatarBusy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    حفظ الصورة
                  </Button>
                )}
              </div>
              {avatarFile && (
                <p className="text-xs text-ink-muted">{avatarFile.name}</p>
              )}
            </div>
          </div>
        </div>

        {wallet && (
          <div className="mb-4 rounded-lg border border-line bg-secondary/60 p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Landmark className="size-4 text-success" />
              رصيد محفظة بادال التجريبية
            </p>
            <p className="text-2xl font-bold tabular-nums text-brand-deep">
              {fmtEGP(wallet.balance)}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              عمولة الخدمة الحالية: {wallet.fee_percent}% — عرض تجريبي للمنافسة.
            </p>
            <Link
              to="/topup"
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
            >
              <Plus className="size-3.5" />
              شحن المحفظة
            </Link>
            {wallet.transactions.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-line pt-2.5">
                {wallet.transactions.slice(0, 8).map((t) => (
                  <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-1 text-xs">
                    <span className="text-ink-muted">
                      {t.note ?? t.kind} — {fmtShortDate(t.created_at)}
                    </span>
                    <span
                      className={`tabular-nums font-semibold ${
                        t.amount >= 0 ? "text-success-ink" : "text-ink"
                      }`}
                    >
                      {t.amount >= 0 ? "+" : ""}
                      {fmtEGP(t.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="mb-4 flex items-start gap-1.5 rounded-md border border-warn-line bg-warn-soft p-2.5 text-xs leading-5 text-gold-deep">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          بادال لا تحجز أي مبلغ ولا تتوسط ماليًا — الدفع مباشر بين الطرفين، وأنت من يحدد طريقة
          استلامك.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wallet-name">اسم المحفظة / الحساب *</Label>
            <Input
              id="wallet-name"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
              placeholder="مثال: فودافون كاش — 010xxxxxxx"
              maxLength={120}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="insta">إنستجرام (اختياري)</Label>
              <Input
                id="insta"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                placeholder="username"
                maxLength={60}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa">رقم واتساب (اختياري)</Label>
              <Input
                id="wa"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="+2010xxxxxxx"
                maxLength={30}
                dir="ltr"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-note">ملاحظة استلام (اختياري)</Label>
            <Textarea
              id="pay-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="مثال: التحويل بعد معاينة، والاستلام من المحل…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="qr">صورة رمز QR للدفع (اختياري)</Label>
            <input
              id="qr"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs file:me-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium"
            />
            {currentQr && (
              <div className="flex items-center gap-3">
                <img
                  src={currentQr}
                  alt="معاينة رمز QR"
                  className="size-28 rounded-lg border border-line bg-card object-contain"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={removeQr}
                >
                  <Trash2 className="size-4" />
                  إزالة الصورة
                </Button>
              </div>
            )}
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
          {saved && (
            <p className="flex items-center gap-1.5 text-sm font-medium text-success-ink">
              <CheckCircle2 className="size-4" />
              تم حفظ بيانات المحفظة.
            </p>
          )}

          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            حفظ المحفظة
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
