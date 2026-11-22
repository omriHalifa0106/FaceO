// src/App.tsx — routes
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { I18nProvider } from '@/i18n/I18nProvider';
import Layout from '@/components/Layout';
import { Spinner } from '@/components/ui';

import Login from '@/pages/Login';
import Register from '@/pages/Register';
import { ForgotPassword, ResetPassword } from '@/pages/PasswordReset';
import Home from '@/pages/Home';
import Groups from '@/pages/Groups';
import GroupDetails from '@/pages/GroupDetails';
import FolderScreen from '@/pages/FolderScreen';
import Upload from '@/pages/Upload';
import MyGallery from '@/pages/MyGallery';
import Profile from '@/pages/Profile';
import JoinGroup from '@/pages/JoinGroup';

function Protected({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const location = useLocation();
  if (isLoadingAuth) return <Spinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/join/:token" element={<JoinGroup />} />

      {/* Authenticated */}
      <Route path="/" element={<Protected><Home /></Protected>} />
      <Route path="/groups" element={<Protected><Groups /></Protected>} />
      <Route path="/groups/:groupId" element={<Protected><GroupDetails /></Protected>} />
      <Route path="/groups/:groupId/people/:kind/:personId" element={<Protected><FolderScreen /></Protected>} />
      <Route path="/upload" element={<Protected><Upload /></Protected>} />
      <Route path="/me/photos" element={<Protected><MyGallery /></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  );
}
