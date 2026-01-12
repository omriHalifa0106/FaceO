import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Users, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import type { Photo } from '../types';

export default function Home() {
    const { user } = useAuth();
    const [recentPhotos, setRecentPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchRecent = async () => {
            if (!user) return;
            try {
                const data = await api.photos.getRecent(user.id);
                setRecentPhotos(data);
            } catch (error) {
                console.error("Failed to fetch recent photos");
            } finally {
                setLoading(false);
            }
        };
        fetchRecent();
    }, [user]);

    return (
        <div className="max-w-6xl mx-auto">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Welcome back, {user?.username}!</h1>
            <p className="text-slate-500 mb-8">Here's what's happening in your groups.</p>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
                <Link to="/groups" className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition cursor-pointer group">
                    <div className="bg-teal-100 p-3 rounded-full text-teal-600 group-hover:bg-teal-600 group-hover:text-white transition">
                        <Users size={24} />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900">My Groups</h3>
                        <p className="text-sm text-slate-500">View and manage groups</p>
                    </div>
                </Link>
                <Link to="/upload" className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition cursor-pointer group">
                    <div className="bg-blue-100 p-3 rounded-full text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition">
                        <Plus size={24} />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900">Upload Photo</h3>
                        <p className="text-sm text-slate-500">Share photos to a group</p>
                    </div>
                </Link>
                <Link to="/gallery" className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition cursor-pointer group">
                    <div className="bg-purple-100 p-3 rounded-full text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition">
                        <ImageIcon size={24} />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900">My Gallery</h3>
                        <p className="text-sm text-slate-500">View all your photos</p>
                    </div>
                </Link>
            </div>

            {/* Recent Photos */}
            <div>
                <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center justify-between">
                    <span>Recent Photos</span>
                    <Link to="/gallery" className="text-sm text-teal-600 hover:underline font-medium">View All</Link>
                </h2>

                {loading ? (
                    <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-600" /></div>
                ) : recentPhotos.length === 0 ? (
                    <div className="bg-white p-10 rounded-2xl text-center border border-slate-100">
                        <ImageIcon size={40} className="mx-auto text-slate-300 mb-3" />
                        <p className="text-slate-500 font-medium">No recent photos found.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {recentPhotos.map((photo) => (
                            <div key={photo.id} className="aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200 hover:shadow-md transition cursor-pointer">
                                <img
                                    src={photo.image_url}
                                    alt="Recent"
                                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                                    onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/150?text=Error')}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}