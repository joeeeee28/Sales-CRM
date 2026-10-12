import { useEffect, lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { Header, Footer } from '@/components/layout';
import { useBootstrap } from '@/store/bootstrap';
import { useAuth } from '@/store/auth';
import { useCart } from '@/store/cart';
import Home from '@/pages/Home';
import Shop from '@/pages/Shop';
import ProductPage from '@/pages/ProductPage';
import CartPage from '@/pages/CartPage';
import Checkout from '@/pages/Checkout';
import OrderConfirmation from '@/pages/OrderConfirmation';
import Track from '@/pages/Track';
import { ContentPage, FaqPage, ContactPage, NotFoundPage } from '@/pages/ContentPages';
import { AccountLayout, LoginPage, RegisterPage, ForgotPasswordPage, ResetPasswordPage, OrdersPage, OrderDetailPage, AddressesPage, WishlistPage, ProfilePage } from '@/pages/account/AccountPages';
import { Spinner } from '@/components/ui';

const AdminApp = lazy(() => import('@/admin/AdminApp'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo({ top: 0 }), [pathname]);
  return null;
}

export default function App() {
  const load = useBootstrap((s) => s.load);
  const initAuth = useAuth((s) => s.init);
  const refreshCart = useCart((s) => s.refresh);
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  useEffect(() => {
    void load();
    void initAuth().then(() => refreshCart());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isAdmin) {
    return (
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Spinner className="size-6 text-muted" /></div>}>
        <AdminApp />
      </Suspense>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <Header />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/shop/:categorySlug" element={<Shop />} />
          <Route path="/product/:slug" element={<ProductPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/order/:number/confirmation" element={<OrderConfirmation />} />
          <Route path="/track" element={<Track />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/pages/:slug" element={<ContentPage />} />
          <Route path="/account/login" element={<LoginPage />} />
          <Route path="/account/register" element={<RegisterPage />} />
          <Route path="/account/forgot" element={<ForgotPasswordPage />} />
          <Route path="/account/reset" element={<ResetPasswordPage />} />
          <Route path="/account" element={<AccountLayout />}>
            <Route index element={<OrdersPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="orders/:id" element={<OrderDetailPage />} />
            <Route path="addresses" element={<AddressesPage />} />
            <Route path="wishlist" element={<WishlistPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
