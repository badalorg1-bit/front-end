import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Ban,
  CheckCircle2,
  Database,
  FileSearch,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  Send,
  Shield,
  ShieldAlert,
  TrendingUp,
  UserCog,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, LoadingSkeleton } from "@/components/states";
import { ListingStatusPill, RequestStatusPill } from "@/components/status";
import {
  ADMIN_ROLE_LABEL,
  ADMIN_ROLE_RANK,
  LISTING_TYPE_LABEL,
  REQUEST_STATUS_LABEL,
  REQUEST_TYPE_LABEL,
  type AdminRole,
  type AdminStats,
  type AdminUserRow,
  type AdminListingRow,
  type AdminRequestRow,
  type AdminNotificationRow,
  type AdminAuditRow,
  listingPriceLabel,
} from "@/lib/types";
import {
  adminBroadcast,
  adminGetStats,
  adminListAudit,
  adminListListings,
  adminListNotifications,
  adminListRequests,
  adminListUsers,
  adminNotifyUser,
  adminSetListingStatus,
  adminSetUserBan,
  adminSetUserRole,
} from "@/lib/admin-api";
import { fmtShortDate } from "@/lib/requests-shared";
import { useAuth } from "@/store/auth";

const ADMIN_TABS = [
  { id: "overview", label: "نظرة عامة", icon: LayoutDashboard },
  { id: "users", label: "المستخدمون", icon: Users },
  { id: "listings", label: "الإعلانات", icon: FileSearch },
  { id: "requests", label: "الطلبات", icon: BarChart3 },
  { id: "notify", label: "الإشعارات", icon: Bell },
  { id: "team", label: "فريق الإدارة", icon: Shield },
  { id: "audit", label: "سجل الإجراءات", icon: ShieldAlert },
] as const;

type AdminTabId = (typeof ADMIN_TABS)[number]["id"];

function roleBadgeVariant(role: AdminRole) {
  if (role === "super_admin") return "destructive";
  if (role === "admin") return "default";
  if (role === "moderator") return "secondary";
  return "outline";
}

function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  return `${mo}/${y.slice(2)}`;
}

function Sparkbars({
  data,
  colorClass,
  label,
}: {
  data: { month: string; count: number }[];
  colorClass: string;
  label: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="space-y-2">
      <div className="flex h-28 items-end gap-1.5" role="img" aria-label={label}>
        {data.map((d) => {
          const h = Math.max(4, Math.round((d.count / max) * 100));
          return (
            <div key={d.month} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] font-medium tabular-nums text-ink-muted">{d.count}</span>
              <div
                className={`w-full rounded-t-sm ${colorClass}`}
                style={{ height: `${h}%` }}
                title={`${monthLabel(d.month)}: ${d.count}`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {data.map((d) => (
          <span key={d.month} className="flex-1 text-center text-[10px] text-ink-muted">
            {monthLabel(d.month)}
          </span>
        ))}
      </div>
    </div>
  );
}

function KpiCard({
  title,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  title: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: "default" | "warn" | "danger" | "ok";
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-900"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : tone === "ok"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-line bg-card";
  return (
    <Card className={`${toneClass} shadow-none`}>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-muted">{title}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
          {hint ? <p className="mt-0.5 text-[11px] text-ink-muted">{hint}</p> : null}
        </div>
        <Icon className="mt-0.5 size-5 shrink-0 opacity-70" />
      </CardContent>
    </Card>
  );
}

export function AdminPage() {
  const { user, profile, configured } = useAuth();
  const [tab, setTab] = useState<AdminTabId>("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [listings, setListings] = useState<AdminListingRow[]>([]);
  const [requests, setRequests] = useState<AdminRequestRow[]>([]);
  const [notes, setNotes] = useState<AdminNotificationRow[]>([]);
  const [audit, setAudit] = useState<AdminAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [userQ, setUserQ] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<AdminRole | "all">("all");
  const [listingQ, setListingQ] = useState("");
  const [listingStatus, setListingStatus] = useState<string>("all");
  const [requestStatus, setRequestStatus] = useState<string>("all");

  const [notifyTitle, setNotifyTitle] = useState("");
  const [notifyBody, setNotifyBody] = useState("");
  const [notifyTarget, setNotifyTarget] = useState<"all" | "user">("all");
  const [notifyUserId, setNotifyUserId] = useState("");

  const myRank = profile?.role ? ADMIN_ROLE_RANK[profile.role] : 0;
  const canModerate = myRank >= ADMIN_ROLE_RANK.moderator;
  const canAdmin = myRank >= ADMIN_ROLE_RANK.admin;
  const canSuper = myRank >= ADMIN_ROLE_RANK.super_admin;

  const loadAll = useCallback(async () => {
    if (!user || !configured || !canModerate) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const s = await adminGetStats();
      setStats(s);
      if (canAdmin) {
        const [u, l, r] = await Promise.all([
          adminListUsers(),
          adminListListings(),
          adminListRequests(),
        ]);
        setUsers(u);
        setListings(l);
        setRequests(r);
      } else {
        const [l, r] = await Promise.all([adminListListings(), adminListRequests()]);
        setListings(l);
        setRequests(r);
      }
      const [n, a] = await Promise.all([adminListNotifications(), canAdmin ? adminListAudit() : Promise.resolve([])]);
      setNotes(n);
      setAudit(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل بيانات الإدارة.");
    } finally {
      setLoading(false);
    }
  }, [user, configured, canModerate, canAdmin]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const filteredUsers = useMemo(() => {
    let rows = users;
    if (userQ.trim()) {
      const t = userQ.trim().toLowerCase();
      rows = rows.filter(
        (u) =>
          u.display_name.toLowerCase().includes(t) ||
          (u.city ?? "").toLowerCase().includes(t) ||
          u.id.includes(t),
      );
    }
    if (userRoleFilter !== "all") rows = rows.filter((u) => u.role === userRoleFilter);
    return rows;
  }, [users, userQ, userRoleFilter]);

  const filteredListings = useMemo(() => {
    let rows = listings;
    if (listingQ.trim()) {
      const t = listingQ.trim().toLowerCase();
      rows = rows.filter(
        (l) =>
          l.title.toLowerCase().includes(t) ||
          l.city.toLowerCase().includes(t) ||
          (l.owner_name ?? "").toLowerCase().includes(t),
      );
    }
    if (listingStatus !== "all") rows = rows.filter((l) => l.status === listingStatus);
    return rows;
  }, [listings, listingQ, listingStatus]);

  const filteredRequests = useMemo(() => {
    if (requestStatus === "all") return requests;
    return requests.filter((r) => r.status === requestStatus);
  }, [requests, requestStatus]);

  async function runAction(fn: () => Promise<void>, okMsg: string) {
    setBusy(true);
    setFlash(null);
    setError(null);
    try {
      await fn();
      setFlash(okMsg);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تنفيذ الإجراء.");
    } finally {
      setBusy(false);
    }
  }

  async function onBroadcast(e: FormEvent) {
    e.preventDefault();
    if (!notifyTitle.trim()) return;
    await runAction(async () => {
      if (notifyTarget === "all") {
        const n = await adminBroadcast({ title: notifyTitle.trim(), body: notifyBody.trim() });
        setFlash(`تم إرسال إشعار إلى ${n} مستخدم.`);
      } else {
        if (!notifyUserId.trim()) throw new Error("اختر المستخدم أو أدخل المعرّف.");
        await adminNotifyUser(notifyUserId.trim(), {
          title: notifyTitle.trim(),
          body: notifyBody.trim(),
        });
        setFlash("تم إرسال الإشعار للمستخدم.");
      }
      setNotifyTitle("");
      setNotifyBody("");
      setNotifyUserId("");
    }, flash ?? "تم الإرسال.");
    setBusy(false);
  }

  if (!configured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={Database}
          title="قاعدة البيانات غير مهيأة"
          description="إعداد لوحة الإدارة يتطلب اتصال Supabase."
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={Shield}
          title="سجّل الدخول للوصول للوحة الإدارة"
          description="لوحة الإدارة متاحة لأعضاء فريق المنصة فقط."
          action={
            <Link
              to="/auth"
              className="inline-flex rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90"
            >
              تسجيل الدخول
            </Link>
          }
        />
      </div>
    );
  }

  if (!canModerate) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={ShieldAlert}
          title="لا تملك صلاحية الوصول"
          description={`حسابك الحالي دوره: ${ADMIN_ROLE_LABEL[profile?.role ?? "user"]}. تواصل مع مسؤول النظام لمنحك صلاحية.`}
          action={
            <Link
              to="/"
              className="inline-flex rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90"
            >
              العودة للرئيسية
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-brand">إدارة المنصة</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            لوحة تحكم بدّال
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            أنت تدخل بدور{" "}
            <Badge variant={roleBadgeVariant(profile?.role ?? "user")}>
              {ADMIN_ROLE_LABEL[profile?.role ?? "user"]}
            </Badge>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={busy}>
          <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
          تحديث
        </Button>
      </div>

      {flash ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <CheckCircle2 className="size-4 shrink-0" />
          {flash}
        </div>
      ) : null}
      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {loading && !stats ? (
        <LoadingSkeleton />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as AdminTabId)}>
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted p-1">
            {ADMIN_TABS.map((t) => {
              if (t.id === "users" && !canAdmin) return null;
              if (t.id === "team" && !canSuper) return null;
              if (t.id === "audit" && !canAdmin) return null;
              return (
                <TabsTrigger key={t.id} value={t.id} className="gap-1.5 text-sm">
                  <t.icon className="size-3.5" />
                  {t.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* ---------------- OVERVIEW ---------------- */}
          <TabsContent value="overview" className="space-y-6">
            {stats ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <KpiCard title="المستخدمون" value={stats.totalUsers} hint={`${stats.staffCount} فريق · ${stats.bannedUsers} محظور`} icon={Users} />
                  <KpiCard title="الإعلانات" value={stats.totalListings} hint={`${stats.publishedListings} منشور · ${stats.blockedListings} محظور`} icon={FileSearch} />
                  <KpiCard title="الطلبات" value={stats.totalRequests} hint={`${stats.pendingRequests} قيد الانتظار`} icon={BarChart3} />
                  <KpiCard title="صفقات مؤكدة" value={stats.acceptedRequests} hint={`${stats.rejectedRequests} مرفوض`} icon={CheckCircle2} tone="ok" />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <TrendingUp className="size-4 text-brand" />
                        نمو المستخدمين
                      </CardTitle>
                      <CardDescription>آخر 8 أشهر — تسجيلات جديدة</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Sparkbars data={stats.usersByMonth} colorClass="bg-brand" label="نمو المستخدمين شهريًا" />
                    </CardContent>
                  </Card>
                  <Card className="shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <BarChart3 className="size-4 text-brand" />
                        نمو الإعلانات
                      </CardTitle>
                      <CardDescription>آخر 8 أشهر — إعلانات جديدة</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Sparkbars data={stats.listingsByMonth} colorClass="bg-teal-600" label="نمو الإعلانات شهريًا" />
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <KpiCard title="إعلانات محظورة" value={stats.blockedListings} icon={Ban} tone={stats.blockedListings ? "danger" : "default"} />
                  <KpiCard title="مستخدمون محظورون" value={stats.bannedUsers} icon={Ban} tone={stats.bannedUsers ? "warn" : "default"} />
                  <KpiCard title="طلبات معلّقة" value={stats.pendingRequests} icon={Bell} tone={stats.pendingRequests > 5 ? "warn" : "default"} />
                </div>
              </>
            ) : (
              <EmptyState icon={Database} title="لا توجد إحصائيات" description="جرّب تحديث الصفحة." />
            )}
          </TabsContent>

          {/* ---------------- USERS ---------------- */}
          <TabsContent value="users" className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <Label htmlFor="user-q">بحث</Label>
                <Input id="user-q" value={userQ} onChange={(e) => setUserQ(e.target.value)} placeholder="اسم أو مدينة…" />
              </div>
              <div className="w-40">
                <Label>الدور</Label>
                <Select value={userRoleFilter} onValueChange={(v) => setUserRoleFilter(v as AdminRole | "all")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="user">مستخدم</SelectItem>
                    <SelectItem value="moderator">مشرف</SelectItem>
                    <SelectItem value="admin">مدير</SelectItem>
                    <SelectItem value="super_admin">مسؤول النظام</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Card className="shadow-none">
              <CardContent className="overflow-x-auto p-0">
                {filteredUsers.length === 0 ? (
                  <EmptyState icon={Users} title="لا يوجد مستخدمون" description="غيّر معايير البحث." />
                ) : (
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="border-b bg-muted/50 text-right text-xs text-ink-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">المستخدم</th>
                        <th className="px-3 py-2 font-medium">الدور</th>
                        <th className="px-3 py-2 font-medium">الحالة</th>
                        <th className="px-3 py-2 font-medium">التسجيل</th>
                        <th className="px-3 py-2 font-medium">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredUsers.map((u) => {
                        const uRank = ADMIN_ROLE_RANK[u.role];
                        const canTouch = canAdmin && uRank < myRank && u.id !== user.id;
                        return (
                          <tr key={u.id} className={u.is_banned ? "bg-red-50/50" : undefined}>
                            <td className="px-3 py-2.5">
                              <div className="font-medium">{u.display_name}</div>
                              <div className="text-xs text-ink-muted">{u.city ?? "—"}</div>
                            </td>
                            <td className="px-3 py-2.5">
                              {canTouch ? (
                                <Select
                                  value={u.role}
                                  onValueChange={(role) =>
                                    void runAction(
                                      () => adminSetUserRole(u.id, role as AdminRole),
                                      `تم تحديث دور ${u.display_name}.`,
                                    )
                                  }
                                >
                                  <SelectTrigger className="h-8 w-36 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(["user", "moderator", "admin"] as AdminRole[])
                                      .filter((r) => ADMIN_ROLE_RANK[r] < myRank)
                                      .map((r) => (
                                        <SelectItem key={r} value={r}>
                                          {ADMIN_ROLE_LABEL[r]}
                                        </SelectItem>
                                      ))}
                                    {canSuper && u.role === "super_admin" ? (
                                      <SelectItem value="super_admin">مسؤول النظام</SelectItem>
                                    ) : null}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Badge variant={roleBadgeVariant(u.role)}>{ADMIN_ROLE_LABEL[u.role]}</Badge>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              {u.is_banned ? (
                                <Badge variant="destructive">محظور</Badge>
                              ) : (
                                <Badge variant="outline">نشط</Badge>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-ink-muted">{fmtShortDate(u.created_at)}</td>
                            <td className="px-3 py-2.5">
                              {canTouch ? (
                                <Button
                                  size="sm"
                                  variant={u.is_banned ? "outline" : "destructive"}
                                  disabled={busy}
                                  onClick={() =>
                                    void runAction(
                                      () => adminSetUserBan(u.id, !u.is_banned),
                                      u.is_banned ? "تم فك الحظر." : "تم حظر المستخدم.",
                                    )
                                  }
                                >
                                  {u.is_banned ? <CheckCircle2 className="size-3.5" /> : <Ban className="size-3.5" />}
                                  {u.is_banned ? "فك الحظر" : "حظر"}
                                </Button>
                              ) : (
                                <span className="text-xs text-ink-muted">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- LISTINGS ---------------- */}
          <TabsContent value="listings" className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <Label htmlFor="listing-q">بحث</Label>
                <Input id="listing-q" value={listingQ} onChange={(e) => setListingQ(e.target.value)} placeholder="عنوان أو مدينة أو مالك…" />
              </div>
              <div className="w-36">
                <Label>الحالة</Label>
                <Select value={listingStatus} onValueChange={setListingStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="published">منشور</SelectItem>
                    <SelectItem value="draft">مسودة</SelectItem>
                    <SelectItem value="archived">مؤرشف</SelectItem>
                    <SelectItem value="blocked">محظور</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Card className="shadow-none">
              <CardContent className="overflow-x-auto p-0">
                {filteredListings.length === 0 ? (
                  <EmptyState
                    icon={FileSearch}
                    title="لا توجد إعلانات"
                    description="غيّر معايير التصفية أو ابحث بكلمة أخرى."
                  />
                ) : (
                  <table className="w-full min-w-[780px] text-sm">
                    <thead className="border-b bg-muted/50 text-right text-xs text-ink-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">الإعلان</th>
                        <th className="px-3 py-2 font-medium">المالك</th>
                        <th className="px-3 py-2 font-medium">النوع</th>
                        <th className="px-3 py-2 font-medium">الحالة</th>
                        <th className="px-3 py-2 font-medium">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredListings.map((l) => (
                        <tr key={l.id} className={l.status === "blocked" ? "bg-red-50/50" : undefined}>
                          <td className="px-3 py-2.5">
                            <Link to={`/listing/${l.id}`} className="font-medium hover:text-brand">
                              {l.title}
                            </Link>
                            <div className="text-xs text-ink-muted">
                              {l.city} · {LISTING_TYPE_LABEL[l.listing_type]} · {listingPriceLabel(l)}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-xs">{l.owner_name ?? "—"}</td>
                          <td className="px-3 py-2.5 text-xs">{LISTING_TYPE_LABEL[l.listing_type]}</td>
                          <td className="px-3 py-2.5">
                            <ListingStatusPill status={l.status as never} />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1.5">
                              {l.status !== "published" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    void runAction(
                                      () => adminSetListingStatus(l.id, "published"),
                                      "تمت إعادة النشر.",
                                    )
                                  }
                                >
                                  نشر
                                </Button>
                              ) : null}
                              {l.status !== "blocked" ? (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={busy}
                                  onClick={() =>
                                    void runAction(
                                      () => adminSetListingStatus(l.id, "blocked"),
                                      "تم حظر الإعلان وإشعار مالكه.",
                                    )
                                  }
                                >
                                  <Ban className="size-3.5" />
                                  حظر
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    void runAction(
                                      () => adminSetListingStatus(l.id, "published"),
                                      "تم فك الحظر.",
                                    )
                                  }
                                >
                                  فك الحظر
                                </Button>
                              )}
                              {canAdmin && l.status !== "archived" ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={() =>
                                    void runAction(
                                      () => adminSetListingStatus(l.id, "archived"),
                                      "تمت الأرشفة.",
                                    )
                                  }
                                >
                                  أرشفة
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- REQUESTS ---------------- */}
          <TabsContent value="requests" className="space-y-4">
            <div className="w-40">
              <Label>الحالة</Label>
              <Select value={requestStatus} onValueChange={setRequestStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="pending">قيد الانتظار</SelectItem>
                  <SelectItem value="accepted">مقبول</SelectItem>
                  <SelectItem value="rejected">مرفوض</SelectItem>
                  <SelectItem value="cancelled">ملغي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Card className="shadow-none">
              <CardContent className="overflow-x-auto p-0">
                {filteredRequests.length === 0 ? (
                  <EmptyState
                    icon={BarChart3}
                    title="لا توجد طلبات"
                    description="غيّر معايير التصفية أو انتظر طلبات جديدة من المستخدمين."
                  />
                ) : (
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="border-b bg-muted/50 text-right text-xs text-ink-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">الإعلان</th>
                        <th className="px-3 py-2 font-medium">الطلب</th>
                        <th className="px-3 py-2 font-medium">من</th>
                        <th className="px-3 py-2 font-medium">إلى</th>
                        <th className="px-3 py-2 font-medium">الحالة</th>
                        <th className="px-3 py-2 font-medium">التاريخ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredRequests.map((r) => (
                        <tr key={r.id}>
                          <td className="px-3 py-2.5 font-medium">{r.listing_title ?? "—"}</td>
                          <td className="px-3 py-2.5 text-xs">
                            {REQUEST_TYPE_LABEL[r.request_type]} · {REQUEST_STATUS_LABEL[r.status]}
                          </td>
                          <td className="px-3 py-2.5 text-xs">{r.requester_name ?? "—"}</td>
                          <td className="px-3 py-2.5 text-xs">{r.owner_name ?? "—"}</td>
                          <td className="px-3 py-2.5">
                            <RequestStatusPill status={r.status} />
                          </td>
                          <td className="px-3 py-2.5 text-xs text-ink-muted">{fmtShortDate(r.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- NOTIFY ---------------- */}
          <TabsContent value="notify" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">إرسال إشعار</CardTitle>
                  <CardDescription>إشعار داخلي يظهر لمستقبليه داخل المنصة.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={onBroadcast} className="space-y-3">
                    <div>
                      <Label htmlFor="n-target">المستلم</Label>
                      <Select
                        value={notifyTarget}
                        onValueChange={(v) => setNotifyTarget(v as "all" | "user")}
                      >
                        <SelectTrigger id="n-target">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">كل المستخدمين</SelectItem>
                          <SelectItem value="user">مستخدم محدد</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {notifyTarget === "user" ? (
                      <div>
                        <Label htmlFor="n-user">معرّف المستخدم (UUID)</Label>
                        <Input
                          id="n-user"
                          value={notifyUserId}
                          onChange={(e) => setNotifyUserId(e.target.value)}
                          placeholder="xxxxxxxx-xxxx-…"
                          dir="ltr"
                        />
                      </div>
                    ) : null}
                    <div>
                      <Label htmlFor="n-title">العنوان</Label>
                      <Input
                        id="n-title"
                        value={notifyTitle}
                        onChange={(e) => setNotifyTitle(e.target.value)}
                        maxLength={120}
                        required
                        placeholder="مثال: تحديث مهم"
                      />
                    </div>
                    <div>
                      <Label htmlFor="n-body">النص</Label>
                      <Textarea
                        id="n-body"
                        value={notifyBody}
                        onChange={(e) => setNotifyBody(e.target.value)}
                        maxLength={2000}
                        rows={4}
                        placeholder="تفاصيل الإشعار…"
                      />
                    </div>
                    <Button type="submit" disabled={busy || !notifyTitle.trim()}>
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                      إرسال
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">آخر الإشعارات المُرسلة</CardTitle>
                  <CardDescription>سجل الإشعارات في النظام</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {notes.length === 0 ? (
                    <EmptyState
                      icon={Bell}
                      title="لا توجد إشعارات بعد"
                      description="ابدأ بإرسال إشعار من النموذج المجاور."
                    />
                  ) : (
                    notes.slice(0, 12).map((n) => (
                      <div key={n.id} className="rounded-lg border border-line px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium">{n.title}</p>
                          <span className="text-[10px] text-ink-muted">{fmtShortDate(n.created_at)}</span>
                        </div>
                        {n.body ? <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{n.body}</p> : null}
                        <p className="mt-1 text-[10px] text-ink-muted">
                          إلى: {n.user_name ?? n.user_id} · {n.kind}
                          {n.read_at ? " · مقروء" : " · غير مقروء"}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ---------------- TEAM ---------------- */}
          <TabsContent value="team" className="space-y-4">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserCog className="size-4" />
                  فريق الإدارة والصلاحيات
                </CardTitle>
                <CardDescription>
                  لإنشاء حساب مدير جديد: يسجّل المستخدم أولًا ثم ترفع صلاحيته من تبويب المستخدمين.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {([
                    ["moderator", "مشرف", "مراجعة الإعلانات · إرسال إشعارات · عرض الطلبات", "moderator"],
                    ["admin", "مدير", "كل صلاحيات المشرف + حظر المستخدمين + تعديل أدوارهم", "admin"],
                    ["super_admin", "مسؤول النظام", "كل الصلاحيات + منح دور مسؤول النظام", "super_admin"],
                  ] as const).map(([role, title, desc, needed]) => (
                    <div key={role} className="rounded-lg border border-line p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">{title}</p>
                        <Badge variant={roleBadgeVariant(role)}>
                          {myRank >= ADMIN_ROLE_RANK[needed] ? "مفعّل" : "يتطلب صلاحية أعلى"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-ink-muted">{desc}</p>
                    </div>
                  ))}
                </div>
                <Separator />
                <div>
                  <p className="text-sm font-semibold">الأعضاء الحاليون في الفريق</p>
                  <ul className="mt-2 space-y-1.5">
                    {users
                      .filter((u) => u.role !== "user")
                      .map((u) => (
                        <li key={u.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
                          <span>
                            {u.display_name}
                            {u.is_banned ? <Badge variant="destructive" className="ms-2">محظور</Badge> : null}
                          </span>
                          <Badge variant={roleBadgeVariant(u.role)}>{ADMIN_ROLE_LABEL[u.role]}</Badge>
                        </li>
                      ))}
                    {users.filter((u) => u.role !== "user").length === 0 ? (
                      <li className="text-sm text-ink-muted">لا يوجد فريق بعد.</li>
                    ) : null}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- AUDIT ---------------- */}
          <TabsContent value="audit" className="space-y-4">
            <Card className="shadow-none">
              <CardContent className="overflow-x-auto p-0">
                {audit.length === 0 ? (
                  <EmptyState
                    icon={ShieldAlert}
                    title="لا توجد إجراءات مسجلة"
                    description="ستظهر هنا إجراءات الإشراف والإدارة عند تنفيذها."
                  />
                ) : (
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="border-b bg-muted/50 text-right text-xs text-ink-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">الإجراء</th>
                        <th className="px-3 py-2 font-medium">بواسطة</th>
                        <th className="px-3 py-2 font-medium">الهدف</th>
                        <th className="px-3 py-2 font-medium">الوقت</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {audit.map((a) => (
                        <tr key={a.id}>
                          <td className="px-3 py-2 font-mono text-xs">{a.action}</td>
                          <td className="px-3 py-2 text-xs">{a.actor_name ?? "—"}</td>
                          <td className="px-3 py-2 text-xs">
                            {a.target_type}
                            {a.meta && typeof a.meta === "object" ? (
                              <span className="text-ink-muted"> · {JSON.stringify(a.meta)}</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-xs text-ink-muted">{fmtShortDate(a.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
