import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider } from "@/store/auth";
import { SiteFooter, SiteHeader } from "@/components/layout";
import { HomePage } from "@/pages/home";
import { SearchPage } from "@/pages/search";
import { ListingPage } from "@/pages/listing";
import { AuthPage } from "@/pages/auth";
import { RequestNewPage, RequestsPage, IncomingRequestsPage } from "@/pages/requests";
import { OwnerPage } from "@/pages/owner";
import { AdminPage } from "@/pages/admin";
import { PublicProfilePage } from "@/pages/profile";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollToTop />
        <div className="flex min-h-screen flex-col bg-paper">
          <SiteHeader />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/listing/:id" element={<ListingPage />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/request/:id" element={<RequestNewPage />} />
              <Route path="/requests" element={<RequestsPage />} />
              <Route path="/incoming" element={<IncomingRequestsPage />} />
              <Route path="/owner" element={<OwnerPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/u/:id" element={<PublicProfilePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <SiteFooter />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
