// src/components/Layout.tsx — app shell for authenticated pages
import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Home, Images, LogOut, Menu, ScanFace, Upload, User as UserIcon, Users, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Avatar, cn } from '@/components/ui';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/groups', label: 'Groups & events', icon: Users, end: false },
  { to: '/upload', label: 'Upload', icon: Upload, end: false },
  { to: '/me/photos', label: 'Photos of me', icon: Images, end: false },
  { to: '/profile', label: 'Profile & face', icon: UserIcon, end: false },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const name = profile?.full_name || user?.email || '';

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const nav = (
    <nav className="flex-1 space-y-1 p-4">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm transition-colors',
              isActive ? 'bg-teal-50 font-semibold text-teal-700' : 'text-slate-600 hover:bg-slate-50',
            )
          }
        >
          <item.icon size={19} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-slate-100 p-4">
      {profile && !profile.face_enrolled_at && (
        <NavLink
          to="/profile"
          onClick={() => setMobileOpen(false)}
          className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"
        >
          <ScanFace size={16} /> Set up your face to find your photos
        </NavLink>
      )}
      <div className="mb-3 flex items-center gap-3 px-1">
        <Avatar name={name} avatarKey={profile?.avatar_key} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{profile?.full_name || 'Your account'}</p>
          <p className="truncate text-xs text-slate-500">{user?.email}</p>
        </div>
      </div>
      <button
        onClick={handleSignOut}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
      >
        <LogOut size={17} /> Sign out
      </button>
    </div>
  );

  const logo = (
    <span className="text-2xl font-bold text-slate-900">
      Face<span className="text-teal-500">O</span>
    </span>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-100 p-6">{logo}</div>
        {nav}
        {footer}
      </aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        {logo}
        <button onClick={() => setMobileOpen((o) => !o)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Menu">
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/40 md:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white pt-16" onClick={(e) => e.stopPropagation()}>
            {nav}
            {footer}
          </aside>
        </div>
      )}

      <main className="p-4 md:ml-64 md:p-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
