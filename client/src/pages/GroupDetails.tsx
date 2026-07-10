// src/pages/GroupDetails.tsx  (Event Screen)
import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
    X, Plus, Filter, Download, UserPlus, LogOut as LeaveIcon,
    Loader2, ImageIcon, Calendar, Users, Check, Copy,
} from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import type { Group, Photo, GroupMember, PhotoFilter } from '../types';

const FILTER_OPTIONS: { value: PhotoFilter; label: string }[] = [
    { value: 'all',       label: 'All Photos' },
    { value: 'mine',      label: 'My Photos' },
    { value: 'group',     label: 'Group Photos' },
    { value: 'landscape', label: 'Landscape' },
];

export default function GroupDetails() {
    const { groupId }  = useParams<{ groupId: string }>();
    const { user }     = useAuth();
    const navigate     = useNavigate();

    const [group,    setGroup]    = useState<Group | null>(null);
    const [photos,   setPhotos]   = useState<Photo[]>([]);
    const [members,  setMembers]  = useState<GroupMember[]>([]);
    const [loading,  setLoading]  = useState(true);

    // UI state
    const [filter,           setFilter]           = useState<PhotoFilter>('all');
    const [filterOpen,       setFilterOpen]       = useState(false);
    const [inviteOpen,       setInviteOpen]       = useState(false);
    const [inviteUrl,        setInviteUrl]        = useState('');
    const [copied,           setCopied]           = useState(false);
    const [isDownloading,    setIsDownloading]    = useState(false);
    const [selectedPhoto,    setSelectedPhoto]    = useState<Photo | null>(null);

    // ── Data fetching ──────────────────────────────────────────────────────────
    const fetchPhotos = useCallback(async (f: PhotoFilter) => {
        if (!groupId || !user) return;
        try {
            const data = await api.photos.getByGroup(groupId, f, user.id);
            setPhotos(data);
        } catch (err) {
            console.error('Failed to fetch photos', err);
        }
    }, [groupId, user]);

    useEffect(() => {
        if (!groupId) return;
        const init = async () => {
            try {
                const [groupData, membersData, photosData] = await Promise.all([
                    api.groups.getDetails(groupId),
                    api.groups.getMembers(groupId),
                    api.photos.getByGroup(groupId, 'all', user?.id),
                ]);
                setGroup(groupData);
                setMembers(membersData);
                setPhotos(photosData);
            } catch (err) {
                console.error('Failed to load group', err);
            } finally {
                setLoading(false);
            }
        };
        init();
    }, [groupId]);

    // Re-fetch photos when filter changes
    useEffect(() => {
        fetchPhotos(filter);
    }, [filter, fetchPhotos]);

    // ── Invite link ────────────────────────────────────────────────────────────
    const handleOpenInvite = async () => {
        if (!groupId) return;
        try {
            const { inviteUrl: url } = await api.groups.getInviteLink(groupId);
            setInviteUrl(url);
            setInviteOpen(true);
        } catch {
            alert('Failed to generate invite link');
        }
    };

    const handleCopyLink = async () => {
        await navigator.clipboard.writeText(inviteUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // ── Download ───────────────────────────────────────────────────────────────
    const handleDownload = async () => {
        if (!groupId || !user) return;
        setIsDownloading(true);
        try {
            await api.photos.downloadZip(Number(groupId), user.id, filter);
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : 'Download failed');
        } finally {
            setIsDownloading(false);
        }
    };

    // ── Leave group ────────────────────────────────────────────────────────────
    const handleLeave = async () => {
        if (!groupId || !user) return;
        if (!window.confirm('Are you sure you want to leave this group?')) return;
        try {
            await api.groups.leave(groupId, user.id);
            navigate('/groups');
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : 'Could not leave group');
        }
    };

    // ── Render ─────────────────────────────────────────────────────────────────
    if (loading) return (
        <div className="flex justify-center mt-20">
            <Loader2 className="animate-spin text-teal-600" size={32} />
        </div>
    );
    if (!group) return <div className="text-center mt-20 text-slate-500">Group not found.</div>;

    const isOwner = group.created_by === user?.id;

    return (
        <div className="max-w-6xl mx-auto">

            {/* ── Group Header card ──────────────────────────────────────── */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-6">

                {/* Title row */}
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 mb-1">{group.name}</h1>
                        <p className="text-slate-500 text-sm">{group.description || 'No description'}</p>
                    </div>
                    <button
                        onClick={() => navigate(-1)}
                        className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 transition"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-5 text-sm text-slate-500 mb-5">
                    <span className="flex items-center gap-1.5">
                        <Calendar size={14} className="text-teal-500" />
                        {format(new Date(group.created_at), 'MMMM d, yyyy')}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <Users size={14} className="text-teal-500" />
                        {members.length} member{members.length !== 1 && 's'}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <ImageIcon size={14} className="text-teal-500" />
                        {photos.length} photo{photos.length !== 1 && 's'}
                    </span>
                </div>

                {/* Members avatars */}
                <div className="flex items-center gap-2 mb-5">
                    <div className="flex -space-x-2">
                        {members.slice(0, 6).map(m => (
                            <div
                                key={m.id}
                                className="w-8 h-8 rounded-full border-2 border-white bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold overflow-hidden"
                                title={m.username}
                            >
                                {m.profile_image
                                    ? <img src={m.profile_image} alt={m.username} className="w-full h-full object-cover" />
                                    : m.username.charAt(0).toUpperCase()
                                }
                            </div>
                        ))}
                        {members.length > 6 && (
                            <div className="w-8 h-8 rounded-full border-2 border-white bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold">
                                +{members.length - 6}
                            </div>
                        )}
                    </div>
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2">
                    <Link
                        to={`/upload?groupId=${group.id}`}
                        className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-teal-700 transition shadow-sm"
                    >
                        <Plus size={16} /> Add Photos
                    </Link>

                    {/* Filter button */}
                    <div className="relative">
                        <button
                            onClick={() => setFilterOpen(o => !o)}
                            className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium hover:border-teal-400 transition"
                        >
                            <Filter size={16} />
                            {FILTER_OPTIONS.find(f => f.value === filter)?.label ?? 'Filter'}
                        </button>
                        {filterOpen && (
                            <div className="absolute top-11 left-0 w-48 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden">
                                {FILTER_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => { setFilter(opt.value); setFilterOpen(false); }}
                                        className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between hover:bg-teal-50 transition ${filter === opt.value ? 'text-teal-700 font-semibold' : 'text-slate-700'}`}
                                    >
                                        {opt.label}
                                        {filter === opt.value && <Check size={14} />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={handleDownload}
                        disabled={isDownloading || photos.length === 0}
                        className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium hover:border-teal-400 transition disabled:opacity-50"
                    >
                        {isDownloading
                            ? <Loader2 size={16} className="animate-spin" />
                            : <Download size={16} />
                        }
                        Download
                    </button>

                    <button
                        onClick={handleOpenInvite}
                        className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium hover:border-teal-400 transition"
                    >
                        <UserPlus size={16} /> Invite
                    </button>

                    {!isOwner && (
                        <button
                            onClick={handleLeave}
                            className="flex items-center gap-2 bg-white border border-red-200 text-red-600 px-4 py-2 rounded-xl text-sm font-medium hover:bg-red-50 transition"
                        >
                            <LeaveIcon size={16} /> Leave
                        </button>
                    )}
                </div>
            </div>

            {/* ── Photos Grid ────────────────────────────────────────────── */}
            <h2 className="text-lg font-bold text-slate-900 mb-4">
                {FILTER_OPTIONS.find(f => f.value === filter)?.label} ({photos.length})
            </h2>

            {photos.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
                    <ImageIcon size={40} className="mx-auto text-slate-300 mb-3" />
                    <h3 className="text-lg font-medium text-slate-900">No photos match this filter</h3>
                    <p className="text-slate-500 text-sm mt-1">Try a different filter or upload photos.</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {photos.map(photo => (
                        <div
                            key={photo.id}
                            onClick={() => setSelectedPhoto(photo)}
                            className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100 border border-slate-200 cursor-pointer"
                        >
                            <img
                                src={photo.image_url}
                                alt={`Photo ${photo.id}`}
                                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                                loading="lazy"
                                onError={e => (e.currentTarget.src = 'https://placehold.co/300?text=⚠')}
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />
                            {(photo.tag_count ?? 0) > 0 && (
                                <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full">
                                    {photo.tag_count} 👤
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* ── Lightbox modal ─────────────────────────────────────────── */}
            {selectedPhoto && (
                <div
                    className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
                    onClick={() => setSelectedPhoto(null)}
                >
                    <div
                        className="relative max-w-3xl w-full bg-white rounded-2xl overflow-hidden shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <button
                            onClick={() => setSelectedPhoto(null)}
                            className="absolute top-3 right-3 p-2 bg-black/40 text-white rounded-xl z-10 hover:bg-black/60 transition"
                        >
                            <X size={20} />
                        </button>
                        <img
                            src={selectedPhoto.image_url}
                            alt="Full view"
                            className="w-full max-h-[70vh] object-contain bg-black"
                        />
                        <div className="p-4 flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-500">
                                    Uploaded {format(new Date(selectedPhoto.uploaded_at), 'PPP')}
                                </p>
                                {(selectedPhoto.tag_count ?? 0) > 0 && (
                                    <p className="text-sm text-teal-600 font-medium mt-0.5">
                                        {selectedPhoto.tag_count} person{selectedPhoto.tag_count !== 1 ? 's' : ''} tagged
                                    </p>
                                )}
                            </div>
                            <a
                                href={selectedPhoto.image_url}
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-teal-700 transition"
                            >
                                <Download size={15} /> Download
                            </a>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Invite modal ───────────────────────────────────────────── */}
            {inviteOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md p-7 shadow-2xl">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-slate-900">Invite Members</h2>
                            <button onClick={() => setInviteOpen(false)} className="text-slate-400 hover:text-slate-700">
                                <X size={20} />
                            </button>
                        </div>
                        <p className="text-slate-500 text-sm mb-4">
                            Share this link with people you want to add to <strong>{group.name}</strong>:
                        </p>
                        <div className="flex gap-2">
                            <input
                                readOnly
                                value={inviteUrl}
                                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 bg-slate-50 outline-none"
                            />
                            <button
                                onClick={handleCopyLink}
                                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition ${copied ? 'bg-green-100 text-green-700' : 'bg-teal-600 text-white hover:bg-teal-700'}`}
                            >
                                {copied ? <><Check size={15} /> Copied!</> : <><Copy size={15} /> Copy</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
