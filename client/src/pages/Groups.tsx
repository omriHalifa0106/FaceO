// src/pages/Groups.tsx
import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Users, Loader2, ArrowRight } from 'lucide-react';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import type { Group } from '../types';

export default function Groups() {
    const { user } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [groups, setGroups]         = useState<Group[]>([]);
    const [loading, setLoading]       = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(searchParams.get('create') === '1');

    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupDesc, setNewGroupDesc] = useState('');
    const [creating, setCreating]         = useState(false);

    const fetchGroups = async () => {
        if (!user) return;
        try {
            const data = await api.groups.getUserGroups(user.id);
            setGroups(data);
        } catch (error) {
            console.error('Failed to load groups', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchGroups(); }, [user]);

    const openModal  = () => { setIsModalOpen(true);  setSearchParams({ create: '1' }); };
    const closeModal = () => { setIsModalOpen(false); setSearchParams({}); };

    const handleCreateGroup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setCreating(true);
        try {
            await api.groups.create({ name: newGroupName, description: newGroupDesc, userId: user.id });
            closeModal();
            setNewGroupName('');
            setNewGroupDesc('');
            fetchGroups();
        } catch {
            alert('Failed to create group');
        } finally {
            setCreating(false);
        }
    };

    if (loading) return (
        <div className="flex justify-center mt-20">
            <Loader2 className="animate-spin text-teal-600" size={32} />
        </div>
    );

    return (
        <div className="max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <Users className="text-teal-600" />
                        My Groups
                    </h1>
                    <p className="text-slate-500 mt-1">Manage your event groups and photos</p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-slate-400 text-sm">{groups.length} group{groups.length !== 1 && 's'}</span>
                    <button
                        onClick={openModal}
                        className="bg-teal-600 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 hover:bg-teal-700 transition shadow-sm font-medium"
                    >
                        <Plus size={18} /> Create Group
                    </button>
                </div>
            </div>

            {/* Groups Grid */}
            {groups.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-2xl shadow-sm border border-dashed border-slate-200">
                    <Users size={40} className="mx-auto text-slate-300 mb-3" />
                    <h3 className="text-xl font-medium text-slate-900">No groups yet</h3>
                    <p className="text-slate-500 mb-6 text-sm">Create your first group to start sharing photos</p>
                    <button
                        onClick={openModal}
                        className="bg-teal-600 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-teal-700 transition inline-flex items-center gap-2"
                    >
                        <Plus size={18} /> Create Group
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {groups.map(group => (
                        <Link
                            to={`/groups/${group.id}`}
                            key={group.id}
                            className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md hover:border-teal-200 transition group block"
                        >
                            <div className="flex justify-between items-start mb-3">
                                <h3 className="text-lg font-bold text-slate-900 group-hover:text-teal-600 transition-colors">
                                    {group.name}
                                </h3>
                                {group.created_by === user?.id && (
                                    <span className="bg-teal-50 text-teal-700 text-xs px-2 py-0.5 rounded-full font-medium">
                                        Admin
                                    </span>
                                )}
                            </div>
                            <p className="text-slate-500 text-sm mb-5 line-clamp-2 min-h-[36px]">
                                {group.description || 'No description provided'}
                            </p>
                            <div className="flex items-center justify-between text-sm text-slate-400">
                                <span>{group.photo_count ?? 0} photos · {group.member_count ?? 0} members</span>
                                <span className="text-teal-600 flex items-center gap-1 font-medium group-hover:gap-2 transition-all">
                                    Open <ArrowRight size={15} />
                                </span>
                            </div>
                        </Link>
                    ))}
                </div>
            )}

            {/* Create Group Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md p-7 shadow-2xl">
                        <h2 className="text-xl font-bold mb-5 text-slate-900">Create New Group</h2>
                        <form onSubmit={handleCreateGroup} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Group name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    className="w-full border border-slate-300 rounded-xl p-3 focus:ring-2 focus:ring-teal-500 outline-none"
                                    value={newGroupName}
                                    onChange={e => setNewGroupName(e.target.value)}
                                    placeholder="e.g. Summer Party 2025"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                                <textarea
                                    className="w-full border border-slate-300 rounded-xl p-3 focus:ring-2 focus:ring-teal-500 outline-none resize-none"
                                    rows={3}
                                    value={newGroupDesc}
                                    onChange={e => setNewGroupDesc(e.target.value)}
                                    placeholder="What is this group about?"
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={closeModal}
                                    className="flex-1 bg-slate-100 text-slate-700 py-2.5 rounded-xl font-medium hover:bg-slate-200 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={creating}
                                    className="flex-1 bg-teal-600 text-white py-2.5 rounded-xl font-medium hover:bg-teal-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {creating && <Loader2 size={16} className="animate-spin" />}
                                    {creating ? 'Creating…' : 'Create Group'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
