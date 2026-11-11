import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock,
  LifeBuoy,
  Loader2,
  Paperclip,
  Send,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, LoadingSkeleton } from "@/components/states";
import {
  addComplaintAttachment,
  listIncomingRequests,
  listMyComplaints,
  listOutgoingRequests,
  openComplaint,
  uploadComplaintAttachment,
  validateComplaintFile,
} from "@/lib/api";
import {
  COMPLAINT_STATUS_LABEL,
  COMPLAINT_TYPES,
  MAX_COMPLAINT_ATTACHMENTS,
  type ComplaintRow,
  type ComplaintStatus,
} from "@/lib/types";
import { fmtShortDate } from "@/lib/format";
import { useAuth } from "@/store/auth";

function statusBadge(status: ComplaintStatus) {
  if (status === "resolved")
    return (
      <Badge variant="default" className="bg-success-soft text-success-ink border-success/30">
        <CheckCircle2 className="size-3" /> {COMPLAINT_STATUS_LABEL.resolved}
      </Badge>
    );
  if (status === "rejected")
    return (
      <Badge variant="destructive">
        <XCircle className="size-3" /> {COMPLAINT_STATUS_LABEL.rejected}
      </Badge>
    );
  if (status === "in_review")
    return (
      <Badge variant="secondary">
        <Clock className="size-3" /> {COMPLAINT_STATUS_LABEL.in_review}
      </Badge>
    );
  return (
    <Badge variant="outline">
      <AlertTriangle className="size-3" /> {COMPLAINT_STATUS_LABEL.open}
    </Badge>
  );
}

export function SupportPage() {
  const { user, ready: authReady } = useAuth();
  const [tab, setTab] = useState<"new" | "mine">("new");

  const [complaints, setComplaints] = useState<ComplaintRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<string>("");
  const [details, setDetails] = useState("");
  const [requestId, setRequestId] = useState<string>("none");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [doneRef, setDoneRef] = useState<string | null>(null);

  const [linkedRequests, setLinkedRequests] = useState<
    Array<{ id: string; label: string }>
  >([]);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const rows = await listMyComplaints();
      setComplaints(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل شكاواك.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authReady && !user) return;
    void load();
  }, [authReady, user, load]);

  // Optional booking linkage: my outgoing + incoming requests.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const [out, inc] = await Promise.all([
          listOutgoingRequests(user.id).catch(() => []),
          listIncomingRequests(user.id).catch(() => []),
        ]);
        if (cancelled) return;
        const all = [...out, ...inc];
        setLinkedRequests(
          all.slice(0, 30).map((r) => ({
            id: r.id,
            label: r.listing?.title ?? r.id.slice(0, 8),
          })),
        );
      } catch {
        /* linkage stays optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const onFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list);
    for (const f of picked) {
      const err = validateComplaintFile(f);
      if (err) {
        setError(err);
        return;
      }
    }
    setError(null);
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_COMPLAINT_ATTACHMENTS));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError(null);
    setDoneRef(null);
    try {
      const res = await openComplaint({
        type,
        details,
        requestId: requestId === "none" ? null : requestId,
      });
      // Attachments: upload first, then register each path (both must pass).
      for (const f of files) {
        const path = await uploadComplaintAttachment(res.id, user.id, f);
        await addComplaintAttachment(res.id, path);
      }
      setDoneRef(res.reference);
      setType("");
      setDetails("");
      setRequestId("none");
      setFiles([]);
      await load();
      setTab("mine");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إرسال الشكوى.");
    } finally {
      setBusy(false);
    }
  };

  if (authReady && !user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <LifeBuoy className="mx-auto mb-3 size-10 text-ink-muted" />
        <h1 className="text-xl font-bold text-ink">الدعم والشكاوى</h1>
        <p className="mt-2 text-sm text-ink-muted">
          سجّل الدخول لفتح شكوى ومتابعتها والاطلاع على رقمها المرجعي.
        </p>
        <Link
          to="/auth"
          className="mt-4 inline-flex rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90"
        >
          تسجيل الدخول
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <p className="text-xs font-semibold tracking-wide text-brand">خدمة العملاء</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">الدعم والشكاوى</h1>
        <p className="mt-1 text-sm text-ink-muted">
          افتح شكوى، حدد نوع المشكلة، أرفق الصور أو المستندات، واحصل على رقم مرجعي
          تتابع به الحالة — تصلك إشعارات عند كل تحديث.
        </p>
      </div>

      {/* Simple two-tab switch (same pattern as requests page). */}
      <div className="flex gap-1 rounded-lg border border-line bg-card p-1">
        <button
          type="button"
          onClick={() => setTab("new")}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            tab === "new" ? "bg-brand/10 text-brand" : "text-ink-muted hover:text-ink"
          }`}
        >
          <Send className="me-1.5 inline size-4" />
          فتح شكوى
        </button>
        <button
          type="button"
          onClick={() => setTab("mine")}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            tab === "mine" ? "bg-brand/10 text-brand" : "text-ink-muted hover:text-ink"
          }`}
        >
          <ClipboardList className="me-1.5 inline size-4" />
          شكاواي ({complaints.length})
        </button>
      </div>

      {doneRef && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft p-3 text-sm font-semibold text-success-ink"
        >
          <CheckCircle2 className="size-4 shrink-0" />
          تم فتح شكواك — رقمك المرجعي:{" "}
          <span className="tabular-nums" dir="ltr">
            {doneRef}
          </span>{" "}
          (احتفظ به للمتابعة)
        </p>
      )}

      {tab === "new" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-ink">
              <LifeBuoy className="size-5 text-brand" />
              فتح شكوى جديدة
            </CardTitle>
            <CardDescription>
              اختر نوع المشكلة، اكتب التفاصيل (10 أحرف على الأقل)، وأرفق ما يصلح
              كدليل — الصور أو المستندات حتى 6 ملفات.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="complaint-type">نوع المشكلة *</Label>
                <Select value={type} onValueChange={setType} required>
                  <SelectTrigger id="complaint-type">
                    <SelectValue placeholder="اختر نوع المشكلة" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPLAINT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="complaint-details">التفاصيل *</Label>
                <Textarea
                  id="complaint-details"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="اشرح ما حدث بالتفصيل — ماذا طلبت، ماذا حدث، ومتى…"
                  rows={5}
                  minLength={10}
                  maxLength={5000}
                  required
                />
                <p className="text-xs text-ink-muted">
                  {details.trim().length} / 5000 حرف (الحد الأدنى 10)
                </p>
              </div>

              {linkedRequests.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="complaint-request">ربط بحجز (اختياري)</Label>
                  <Select value={requestId} onValueChange={setRequestId}>
                    <SelectTrigger id="complaint-request">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">بدون ربط</SelectItem>
                      {linkedRequests.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="complaint-files">
                  إرفاق صور أو مستندات (اختياري — حتى {MAX_COMPLAINT_ATTACHMENTS})
                </Label>
                <input
                  id="complaint-files"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                  onChange={(e) => onFiles(e.target.files)}
                  className="block w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs file:me-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium"
                />
                {files.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {files.map((f, i) => (
                      <li
                        key={`${f.name}-${i}`}
                        className="flex items-center gap-1 rounded-md border border-line bg-secondary/50 px-2 py-1 text-xs"
                      >
                        <Paperclip className="size-3" />
                        <span className="max-w-40 truncate">{f.name}</span>
                        <button
                          type="button"
                          aria-label={`إزالة ${f.name}`}
                          className="text-ink-muted hover:text-destructive"
                          onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {error && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {error}
                </p>
              )}

              <Button type="submit" disabled={busy} className="w-full">
                {busy && <Loader2 className="size-4 animate-spin" />}
                <Send className="size-4" />
                إرسال الشكوى
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-ink">
              <ClipboardList className="size-5 text-brand" />
              شكاواي
            </CardTitle>
            <CardDescription>
              تابع حالة كل شكوى وسبب القرار عند إغلاقها.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingSkeleton count={3} />
            ) : complaints.length === 0 ? (
              <EmptyState
                icon={LifeBuoy}
                title="لا توجد شكاوى بعد"
                description="عندك مشكلة في حجز أو دفع أو منتج؟ افتح شكوى من تبويب «فتح شكوى» واحصل على رقم مرجعي."
                action={
                  <Button size="sm" variant="outline" onClick={() => setTab("new")}>
                    <Send className="size-4" />
                    فتح شكوى
                  </Button>
                }
              />
            ) : error ? (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {complaints.map((c) => (
                  <li key={c.id} className="space-y-2 py-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="font-semibold tabular-nums text-ink"
                          dir="ltr"
                        >
                          {c.reference}
                        </span>
                        <span className="text-sm text-ink-muted">· {c.complaint_type}</span>
                      </div>
                      {statusBadge(c.status)}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-ink">
                      {c.details}
                    </p>
                    {c.resolution && (
                      <p className="rounded-md border border-line bg-secondary/50 p-2.5 text-xs leading-5 text-ink-muted">
                        <span className="font-semibold text-ink">قرار الإدارة: </span>
                        {c.resolution}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                      <span>فُتحت: {fmtShortDate(c.created_at)}</span>
                      {c.resolved_at && <span>أُغلقت: {fmtShortDate(c.resolved_at)}</span>}
                      {c.attachments.length > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="size-3" />
                          {c.attachments.length} مرفق
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <p className="flex items-start gap-2 rounded-md border border-line bg-card p-3 text-xs leading-5 text-ink-muted">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-brand" />
        لا يُخصم أي مبلغ تأمين أو تُفرض عقوبة بناءً على ادعاء غير موثق من طرف
        واحد — تُسجّل قرارات المنصة وأسبابها دائمًا.
      </p>

      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
      >
        <ArrowRight className="size-4" />
        العودة للرئيسية
      </Link>
    </div>
  );
}
