import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout'; // ייבוא Layout

import Register from './pages/Register';
import Home from './pages/Home';           // חדש
import Groups from './pages/Groups';
import GroupDetails from './pages/GroupDetails'; // חדש
import Upload from './pages/Upload';
import MyGallery from './pages/MyGallery';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-center">Loading...</div>;
  if (!user) return <Navigate to="/register" />;
  // עוטפים ב-Layout את כל הדפים המוגנים
  return <Layout>{children}</Layout>;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/register" element={<Register />} />

      {/* דף הבית החדש */}
      <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />

      <Route path="/groups" element={<ProtectedRoute><Groups /></ProtectedRoute>} />

      {/* ראוט דינמי לדף קבוצה */}
      <Route path="/groups/:groupId" element={<ProtectedRoute><GroupDetails /></ProtectedRoute>} />

      <Route path="/upload" element={<ProtectedRoute><Upload /></ProtectedRoute>} />
      <Route path="/gallery" element={<ProtectedRoute><MyGallery /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;