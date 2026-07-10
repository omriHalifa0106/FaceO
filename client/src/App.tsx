// src/App.tsx
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';

import Register     from './pages/Register';
import Home         from './pages/Home';
import Groups       from './pages/Groups';
import GroupDetails from './pages/GroupDetails';
import FolderScreen from './pages/FolderScreen';
import Upload       from './pages/Upload';
import MyGallery    from './pages/MyGallery';
import JoinGroup    from './pages/JoinGroup';

// Protects routes — redirects to /register if not authenticated
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
    const { user, loading } = useAuth();
    if (loading) return <div className="p-10 text-center text-slate-400">Loading…</div>;
    if (!user)   return <Navigate to="/register" />;
    return <Layout>{children}</Layout>;
};

function AppRoutes() {
    return (
        <Routes>
            {/* Public */}
            <Route path="/register"      element={<Register />} />
            <Route path="/join/:token"   element={<JoinGroup />} />

            {/* Protected */}
            <Route path="/"                                element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/groups"                          element={<ProtectedRoute><Groups /></ProtectedRoute>} />
            <Route path="/groups/:groupId"                 element={<ProtectedRoute><GroupDetails /></ProtectedRoute>} />
            <Route path="/groups/:groupId/faces"           element={<ProtectedRoute><FolderScreen /></ProtectedRoute>} />
            <Route path="/upload"                          element={<ProtectedRoute><Upload /></ProtectedRoute>} />
            <Route path="/gallery"                         element={<ProtectedRoute><MyGallery /></ProtectedRoute>} />

            <Route path="*" element={<Navigate to="/" />} />
        </Routes>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <AppRoutes />
            </BrowserRouter>
        </AuthProvider>
    );
}
