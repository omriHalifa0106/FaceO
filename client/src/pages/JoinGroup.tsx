// src/pages/JoinGroup.tsx
//
// Rendered when a user clicks an invite link:
//   /join/:token
//
// If the user is already logged in → join immediately and redirect.
// If not → show a small prompt to log in first, then join.

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, Users, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';

export default function JoinGroup() {
    const { token }    = useParams<{ token: string }>();
    const { user }     = useAuth();
    const navigate     = useNavigate();

    const [status, setStatus] = useState<'idle' | 'joining' | 'done' | 'error'>('idle');
    const [groupName, setGroupName] = useState('');
    const [message,   setMessage]   = useState('');

    useEffect(() => {
        if (!token || !user) return;        // wait for auth state
        setStatus('joining');

        api.groups.joinByToken(token, user.id)
            .then((res: { group: { name: string; id: number }; alreadyMember?: boolean }) => {
                setGroupName(res.group.name);
                setStatus('done');
                setTimeout(() => navigate(`/groups/${res.group.id}`), 1800);
            })
            .catch((err: Error) => {
                setMessage(err.message || 'Invalid or expired invite link');
                setStatus('error');
            });
    }, [token, user]);

    // ── Not logged in ─────────────────────────────────────────────────────────
    if (!user) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
                <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
                    <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Users size={30} className="text-teal-600" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2">You're invited!</h2>
                    <p className="text-slate-500 text-sm mb-6">
                        Please sign in to join this group.
                    </p>
                    <Link
                        to={`/register?redirect=/join/${token}`}
                        className="flex items-center justify-center gap-2 bg-teal-600 text-white w-full py-3 rounded-xl font-medium hover:bg-teal-700 transition"
                    >
                        <LogIn size={18} /> Sign In / Register
                    </Link>
                </div>
            </div>
        );
    }

    // ── Joining ───────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
                {status === 'joining' || status === 'idle' ? (
                    <>
                        <Loader2 size={40} className="animate-spin text-teal-500 mx-auto mb-4" />
                        <p className="text-slate-600">Joining group…</p>
                    </>
                ) : status === 'done' ? (
                    <>
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
                            ✅
                        </div>
                        <h2 className="text-xl font-bold text-slate-900 mb-1">Joined!</h2>
                        <p className="text-slate-500 text-sm">Welcome to <strong>{groupName}</strong>. Redirecting…</p>
                    </>
                ) : (
                    <>
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
                            ❌
                        </div>
                        <h2 className="text-xl font-bold text-slate-900 mb-1">Oops</h2>
                        <p className="text-slate-500 text-sm mb-4">{message}</p>
                        <Link to="/" className="text-teal-600 font-medium hover:underline text-sm">
                            Back to home
                        </Link>
                    </>
                )}
            </div>
        </div>
    );
}
