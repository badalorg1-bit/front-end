import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { ShieldAlert, Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/store/auth";
import { SiteFooter, SiteHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { HomePage } from "@/pages/home";
import { SearchPage } from "@/pages/search";
import { ListingPage } from "@/pages/listing";
import { AuthPage } from "@/pages/auth";
import { ResetPasswordPage } from "@/pages/reset-password";
import { PublicProfilePage } from "@/pages/profile";
import { PricingPage } from "@/pages/pricing";
import { MerchantPage } from "@/pages/merchant";
import { PromoPage } from "@/pages/promo";
import { BannerPage } from "@/pages/banner";
import { SubscribePage } from "@/pages/subscribe";
import { TopupPage } from "@/pages/topup";
import { ChatWidget } from "@/components/chat/ChatWidget";

const AdminPage = lazy(() => import("@/pages/admin").then((m) => ({ default: m.AdminPage })));
const RequestsPage = lazy(() => import("@/pages/requests").then((m) => ({ default: m.RequestsPage })));
const RequestDetailPage = lazy(() => import("@/pages/requests").then((m) => ({ default: m.RequestDetailPage })));
const RequestNewPage = lazy(() => import("@/pages/requests").then((m) => ({ default: m.RequestNewPage })));
const IncomingRequestsPage = lazy(() => import("@/pages/requests").then((m) => ({ default: m.IncomingRequestsPage })));
const MessagesPage = lazy(() => import("@/pages/messages").then((m) => ({ default: m.MessagesPage })));
const ConversationPage = lazy(() => import("@/pages/messages").then((m) => ({ default: m.ConversationPage })));
const StartConversationPage = lazy(() => import("@/pages/messages").then((m) => ({ default: m.StartConversationPage })));
const OwnerPage = lazy(() => import("@/pages/owner").then((m) => ({ default: m.OwnerPage })));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

/** Full-page block for banned accounts. */
function BannedGate({ children }: { children: ReactNode }) {
  const { user, profile, signOut } = useAuth();
  if (user && profile?.is_banned) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-4">
        <ShieldAlert className="size-12 text-destructive" />
        <h1 className="text-xl font-bold text-ink">الحساب محظور</h1>
        <p className="max-w-md text-center text-sm leading-6 text-ink-muted">
          تم إيقاف هذا الحساب بسبب مخالفة شروط الاستخدام. للاستفسار تواصل مع الإدارة.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            void signOut().then(() => {
              window.location.href = import.meta.env.BASE_URL || "/";
            });
          }}
        >
          تسجيل الخروج
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}

const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-ink-muted">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={basename}>
        <BannedGate>
          <ScrollToTop />
          <div className="flex min-h-screen flex-col bg-paper">
            <SiteHeader />
            <main className="flex-1">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/listing/:id" element={<ListingPage />} />
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/request/:id" element={<Suspense fallback={<RouteFallback />}><RequestNewPage /></Suspense>} />
                <Route path="/requests" element={<Suspense fallback={<RouteFallback />}><RequestsPage /></Suspense>} />
                <Route path="/requests/:id" element={<Suspense fallback={<RouteFallback />}><RequestDetailPage /></Suspense>} />
                <Route path="/incoming" element={<Suspense fallback={<RouteFallback />}><IncomingRequestsPage /></Suspense>} />
                <Route path="/owner" element={<Suspense fallback={<RouteFallback />}><OwnerPage /></Suspense>} />
                <Route path="/admin" element={<Suspense fallback={<RouteFallback />}><AdminPage /></Suspense>} />
                <Route path="/u/:id" element={<PublicProfilePage />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/merchant" element={<MerchantPage />} />
                <Route path="/promo" element={<PromoPage />} />
                <Route path="/banner" element={<BannerPage />} />
                <Route path="/subscribe/:planId" element={<SubscribePage />} />
                <Route path="/topup" element={<TopupPage />} />
                <Route path="/messages" element={<Suspense fallback={<RouteFallback />}><MessagesPage /></Suspense>} />
                <Route path="/messages/start" element={<Suspense fallback={<RouteFallback />}><StartConversationPage /></Suspense>} />
                <Route path="/messages/:id" element={<Suspense fallback={<RouteFallback />}><ConversationPage /></Suspense>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
            <SiteFooter />
            <ChatWidget />
          </div>
        </BannedGate>
      </BrowserRouter>
    </AuthProvider>
  );
}
