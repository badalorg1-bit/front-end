import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { AuthProvider, useAuth } from "@/store/auth";
import { SiteFooter, SiteHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { HomePage } from "@/pages/home";
import { SearchPage } from "@/pages/search";
import { ListingPage } from "@/pages/listing";
import { AuthPage } from "@/pages/auth";
import { ResetPasswordPage } from "@/pages/reset-password";
import { RequestNewPage, RequestDetailPage, RequestsPage, IncomingRequestsPage } from "@/pages/requests";
import { OwnerPage } from "@/pages/owner";
import { AdminPage } from "@/pages/admin";
import { PublicProfilePage } from "@/pages/profile";
import { PricingPage } from "@/pages/pricing";
import { MerchantPage } from "@/pages/merchant";
import { PromoPage } from "@/pages/promo";
import { BannerPage } from "@/pages/banner";
import { SubscribePage } from "@/pages/subscribe";
import { TopupPage } from "@/pages/topup";
import { ConversationPage, MessagesPage, StartConversationPage } from "@/pages/messages";
import { ChatWidget } from "@/components/chat/ChatWidget";

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
              window.location.href = "/";
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

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
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
                <Route path="/request/:id" element={<RequestNewPage />} />
                <Route path="/requests" element={<RequestsPage />} />
                <Route path="/requests/:id" element={<RequestDetailPage />} />
                <Route path="/incoming" element={<IncomingRequestsPage />} />
                <Route path="/owner" element={<OwnerPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/u/:id" element={<PublicProfilePage />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/merchant" element={<MerchantPage />} />
                <Route path="/promo" element={<PromoPage />} />
                <Route path="/banner" element={<BannerPage />} />
                <Route path="/subscribe/:planId" element={<SubscribePage />} />
                <Route path="/topup" element={<TopupPage />} />
                <Route path="/messages" element={<MessagesPage />} />
                <Route path="/messages/start" element={<StartConversationPage />} />
                <Route path="/messages/:id" element={<ConversationPage />} />
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
