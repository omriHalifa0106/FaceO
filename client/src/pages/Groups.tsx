import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom'; // <--- חשוב מאוד!
import { Plus, Users, Loader2, ArrowRight } from 'lucide-react';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import type { Group } from '../types';

export default function Groups() {
    const { user } = useAuth();
    const [groups, setGroups] = useState<Group[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Form State for Create Group
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupDesc, setNewGroupDesc] = useState('');

    const fetchGroups = async () => {
        if (!user) return;
        try {
            const data = await api.groups.getUserGroups(user.id);
            setGroups(data);
        } catch (error) {
            console.error("Failed to load groups", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchGroups();
    }, [user]);

    const handleCreateGroup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        try {
            await api.groups.create({
                name: newGroupName,
                description: newGroupDesc,
                userId: user.id
            });
            setIsModalOpen(false);
            setNewGroupName('');
            setNewGroupDesc('');
            fetchGroups(); // Refresh list
        } catch (error) {
            alert('Failed to create group');
        }
    };

    if (loading) return <div className="flex justify-center mt-20"><Loader2 className="animate-spin text-teal-600" /></div>;

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
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="bg-teal-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-teal-700 transition shadow-sm"
                >
                    <Plus size={20} />
                    Create Group
                </button>
            </div>

            {/* Groups Grid */}
            {groups.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-2xl shadow-sm border border-slate-100">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Users size={32} className="text-slate-300" />
                    </div>
                    <h3 className="text-xl font-medium text-slate-900">No groups yet</h3>
                    <p className="text-slate-500 mb-6">Create your first group to start sharing photos</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {groups.map((group) => (
                        <Link
                            to={`/groups/${group.id}`}
                            key={group.id}
                            className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition group block relative"
                        >
                            <div className="flex justify-between items-start mb-4">
                                <h3 className="text-xl font-bold text-slate-900 group-hover:text-teal-600 transition-colors">
                                    {group.name}
                                </h3>
                                {group.created_by === user?.id && (
                                    <span className="bg-teal-50 text-teal-700 text-xs px-2 py-1 rounded-full font-medium">
                                        Admin
                                    </span>
                                )}
                            </div>
                            <p className="text-slate-500 text-sm mb-6 line-clamp-2 min-h-[40px]">
                                {group.description || 'No description provided'}
                            </p>

                            <div className="flex items-center text-teal-600 font-medium text-sm mt-auto">
                                View Group <ArrowRight size={16} className="ml-2 group-hover:translate-x-1 transition-transform" />
                            </div>
                        </Link>
                    ))}
                </div>
            )}

            {/* Create Group Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl">
                        <h2 className="text-xl font-bold mb-4">Create New Group</h2>
                        <form onSubmit={handleCreateGroup} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                                <input
                                    type="text" required
                                    className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-teal-500 outline-none"
                                    value={newGroupName}
                                    onChange={e => setNewGroupName(e.target.value)}
                                    placeholder="e.g. Summer Party"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                                <textarea
                                    className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-teal-500 outline-none"
                                    rows={3}
                                    value={newGroupDesc}
                                    onChange={e => setNewGroupDesc(e.target.value)}
                                    placeholder="What is this group about?"
                                />
                            </div>
                            <div className="flex gap-3 mt-6">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-lg font-medium hover:bg-slate-200">
                                    Cancel
                                </button>
                                <button type="submit" className="flex-1 bg-teal-600 text-white py-2 rounded-lg font-medium hover:bg-teal-700">
                                    Create
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}