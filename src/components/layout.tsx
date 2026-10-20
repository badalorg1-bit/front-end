import { NavLink, Link, useNavigate } from "react-router-dom";
import { Crown, LogIn, LogOut, MessageCircle, Plus, Shield, User } from "lucide-react";
import { cn } from "cn";
import { Wordmark } from "@/components/wordmark";
import { NotificationBell } from "@/components/notifications";
import { ADMIN_ROLE_RANK } from "@/lib/types";
import { useAuth } from "@/store/auth";

type NavItem = { to: string; label: string; end: boolean; icon?: typeof Crown };

const navItems: NavItem[] = [
  { to: "/", label: "الرئيسية", end: true },
  { to: "/search", label: "تصفح الإعلانات", end: false },
  { to: "/requests", label: "طلباتي", end: false },
  { to: "/messages", label: "الرسائل", end: false, icon: MessageCircle },
  { to: "/owner", label: "لوحة المالك", end: false },
  { to: "/pricing", label: "الباقات", end: false, icon: Crown },
];

export function SiteHeader() {
  const { user, profile, signOut, configured } = useAuth();
  const navigate = useNavigate();
  const staffRank = profile?.role ? ADMIN_ROLE_RANK[profile.role] : 0;
  const isStaff = staffRank >= ADMIN_ROLE_RANK.moderator;
  const items = isStaff
    ? [...navItems, { to: "/admin", label: "لوحة الإدارة", end: false }]
    : navItems;

  return (
    <header className="sticky top-0 z-40 bg-brand-deep text-paper shadow-l2">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Wordmark className="text-paper [&>span:last-child]:text-paper" />

        <nav
          aria-label="التنقل الرئيسي"
          className="order-3 w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:order-none md:w-auto"
        >
          <ul className="flex items-center gap-0.5 sm:gap-1">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:px-3 sm:text-sm",
                      isActive
                        ? "bg-white/15 text-white"
                        : "text-paper/75 hover:bg-white/10 hover:text-white",
                    )
                  }
                >
                  {item.icon ? <item.icon className="size-3.5" /> : null}
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <Link
            to={user ? "/owner?tab=add" : "/auth"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-paper px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-white/60 outline-none"
          >
            <Plus className="size-4" />
            أضف إعلانك
          </Link>

          {configured && user ? (
            <div className="flex items-center gap-2">
              <NotificationBell />
              {isStaff ? (
                <Link
                  to="/admin"
                  className="hidden items-center gap-1.5 rounded-md border border-white/25 px-2 py-1.5 text-xs font-medium text-paper/90 transition-colors hover:border-white/50 hover:text-white sm:inline-flex"
                  title="لوحة الإدارة"
                >
                  <Shield className="size-3.5" />
                  إدارة
                </Link>
              ) : null}
              <Link
                to="/owner"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-paper/85 hover:bg-white/10 hover:text-white"
                title={profile?.display_name ?? user.email ?? ""}
              >
                <User className="size-3.5" />
                <span className="max-w-28 truncate">
                  {profile?.display_name ?? user.email ?? "حسابي"}
                </span>
              </Link>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  navigate("/");
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/25 px-2 py-1.5 text-xs font-medium text-paper/85 transition-colors hover:border-white/50 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 outline-none"
                title="تسجيل الخروج"
              >
                <LogOut className="size-3.5" />
                خروج
              </button>
            </div>
          ) : (
            <Link
              to="/auth"
              className="inline-flex items-center gap-1.5 rounded-md border border-white/25 px-2.5 py-1.5 text-xs font-medium text-paper/90 transition-colors hover:border-white/50 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 outline-none"
            >
              <LogIn className="size-3.5" />
              دخول
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const links = [
    { to: "/", label: "الرئيسية" },
    { to: "/search", label: "تصفح الإعلانات" },
    { to: "/requests", label: "طلباتي" },
    { to: "/messages", label: "الرسائل" },
    { to: "/owner", label: "لوحة المالك" },
    { to: "/pricing", label: "الباقات" },
    { to: "/promo", label: "العروض الترويجية" },
    { to: "/merchant", label: "حسابات التجار" },
    { to: "/banner", label: "إعلان البانر" },
    { to: "/auth", label: "الدخول" },
  ];
  return (
    <footer className="mt-16 border-t border-line bg-card">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1.5">
          <Wordmark size="sm" href="/" />
          <p className="max-w-md text-xs leading-5 text-ink-muted">
            بدّال — تأجير وبيع ومقايضة الأغراض بين الأفراد. النسخة الحالية تعمل على Supabase
            (Postgres + Auth + Storage) وتخزن الأسعار بالجنيه المصري كأعداد صحيحة.
          </p>
        </div>
        <nav aria-label="روابط التذييل">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {links.map((l) => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  className="text-ink-muted transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-ring outline-none rounded"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
