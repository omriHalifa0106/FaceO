// src/pages/Home.tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    Plus, Users, Image as ImageIcon, Loader2,
    Menu, X, LayoutDashboard, Upload,
    LogOut, User as UserIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import type { Photo } from '../types';

export default function Home() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [recentPhotos, setRecentPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        if (!user) return;
        api.photos.getRecent(user.id)
            .then(setRecentPhotos)
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [user]);

    const handleLogout = () => {
        logout();
        navigate('/register');
    };

    const navButtons = [
        { label: 'Create Group',    path: '/groups?create=1',  icon: Plus,         color: 'bg-teal-600 hover:bg-teal-700 text-white' },
        { label: 'My Groups',       path: '/groups',            icon: Users,        color: 'bg-white border border-slate-200 hover:border-teal-400 text-slate-700' },
        { label: 'My Gallery',      path: '/gallery',           icon: ImageIcon,    color: 'bg-white border border-slate-200 hover:border-teal-400 text-slate-700' },
        { label: 'Upload Photo',    path: '/upload',            icon: Upload,       color: 'bg-white border border-slate-200 hover:border-teal-400 text-slate-700' },
    ];

    const menuLinks = [
        { label: 'Dashboard',   path: '/',        icon: LayoutDashboard },
        { label: 'Upload',      path: '/upload',  icon: Upload },
        { label: 'My Gallery',  path: '/gallery', icon: ImageIcon },
        { label: 'My Groups',   path: '/groups',  icon: Users },
        { label: 'Profile',     path: '/profile', icon: UserIcon },
    ];

    return (
        <div className="max-w-6xl mx-auto">

            {/* ── Header bar ──────────────────────────────────────────── */}
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
                    Face<span className="text-teal-500">O</span>
                </h1>

                {/* Hamburger */}
                <div className="relative">
                    <button
                        onClick={() => setMenuOpen(o => !o)}
                        className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition"
                        aria-label="Menu"
                    >
                        {menuOpen ? <X size={24} /> : <Menu size={24} />}
                    </button>

                    {/* Dropdown */}
                    {menuOpen && (
                        <div className="absolute right-0 top-12 w-52 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden">
                            {menuLinks.map(item => (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    onClick={() => setMenuOpen(false)}
                                    className="flex items-center gap-3 px-4 py-3 text-slate-700 hover:bg-teal-50 hover:text-teal-700 transition text-sm"
                                >
                                    <item.icon size={17} />
                                    {item.label}
                                </Link>
                            ))}
                            <div className="border-t border-slate-100" />
                            <button
                                onClick={handleLogout}
                                className="flex items-center gap-3 w-full px-4 py-3 text-red-600 hover:bg-red-50 transition text-sm"
                            >
                                <LogOut size={17} />
                                Logout
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Welcome ─────────────────────────────────────────────── */}
            <p className="text-2xl font-semibold text-slate-800 mb-1">
                Welcome back, <span className="text-teal-600">{user?.username}</span>!
            </p>
            <p className="text-slate-500 mb-8">Here's what's happening in your groups.</p>

            {/* ── Navigation buttons ───────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
                {navButtons.map(btn => (
                    <Link
                        key={btn.path}
                        to={btn.path}
                        className={`flex flex-col items-center justify-center gap-2 px-4 py-5 rounded-2xl shadow-sm transition font-medium text-sm ${btn.color}`}
                    >
                        <btn.icon size={22} />
                        {btn.label}
                    </Link>
                ))}
            </div>

            {/* ── Recent Photos ────────────────────────────────────────── */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-slate-900">Recent Photos</h2>
                    <Link
                        to="/gallery"
                        className="text-sm text-teal-600 hover:underline font-medium"
                    >
                        View all →
                    </Link>
                </div>

                {loading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="animate-spin text-teal-600" size={32} />
                    </div>
                ) : recentPhotos.length === 0 ? (
                    <div className="bg-white p-12 rounded-2xl text-center border border-dashed border-slate-200">
                        <ImageIcon size={44} className="mx-auto text-slate-300 mb-3" />
                        <p className="text-slate-500 font-medium mb-1">No photos yet</p>
                        <p className="text-slate-400 text-sm">
                            Upload photos to your groups and they'll appear here.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {recentPhotos.map(photo => (
                            <div
                                key={photo.id}
                                className="aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200 hover:shadow-md transition cursor-pointer"
                            >
                                <img
                                    src={photo.image_url}
                                    alt="Recent"
                                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                                    onError={e => (e.currentTarget.src = 'https://placehold.co/200?text=⚠')}
                                    loading="lazy"
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
