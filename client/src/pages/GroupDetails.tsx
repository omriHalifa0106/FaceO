import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Users, Calendar, Loader2, ImageIcon } from 'lucide-react';
import { api } from '../utils/api';
import type { Group, Photo } from '../types';
import { format } from 'date-fns'; // וודא שהתקנת: npm i date-fns

export default function GroupDetails() {
    const { groupId } = useParams<{ groupId: string }>();
    const navigate = useNavigate();
    const [group, setGroup] = useState<Group | null>(null);
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchGroupData = async () => {
            if (!groupId) return;
            try {
                setLoading(true);
                // שליפת פרטי הקבוצה והתמונות במקביל
                const [groupData, photosData] = await Promise.all([
                    api.groups.getDetails(groupId),
                    api.photos.getByGroup(groupId)
                ]);
                setGroup(groupData);
                setPhotos(photosData);
            } catch (error) {
                console.error("Failed to fetch group data", error);
                // navigate('/groups'); // אפשר להחזיר אם יש שגיאה
            } finally {
                setLoading(false);
            }
        };
        fetchGroupData();
    }, [groupId, navigate]);

    if (loading) return <div className="flex justify-center mt-20"><Loader2 className="animate-spin text-teal-600" /></div>;
    if (!group) return <div className="text-center mt-20">Group not found.</div>;

    return (
        <div className="max-w-6xl mx-auto">
            {/* Header */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-8">
                <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-500 hover:text-slate-700 mb-4 transition">
                    <ArrowLeft size={18} /> Back
                </button>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 mb-2">{group.name}</h1>
                        <p className="text-slate-600 mb-4 max-w-2xl">{group.description || "No description available."}</p>

                        <div className="flex items-center gap-6 text-sm text-slate-500">
                            <div className="flex items-center gap-2">
                                <Calendar size={16} className="text-teal-600" />
                                <span>Created {format(new Date(group.created_at), 'MMMM d, yyyy')}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Users size={16} className="text-teal-600" />
                                <span>{photos.length} Photos</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-3 w-full md:w-auto">
                        {/* אפשר להוסיף כפתור הזמנה כאן בעתיד */}
                        <Link
                            to={`/upload?groupId=${group.id}`} // אפשר לשפר שזה יבחר אוטומטית בדף ההעלאה
                            className="bg-teal-600 text-white px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 hover:bg-teal-700 transition font-medium w-full md:w-auto shadow-sm"
                        >
                            <Plus size={20} />
                            Add Photo
                        </Link>
                    </div>
                </div>
            </div>

            {/* Photos Grid */}
            <h2 className="text-xl font-bold text-slate-900 mb-4">Group Photos</h2>
            {photos.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-2xl shadow-sm border border-slate-100">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <ImageIcon size={32} className="text-slate-300" />
                    </div>
                    <h3 className="text-xl font-medium text-slate-900">No photos yet</h3>
                    <p className="text-slate-500 mb-6">Be the first to capture a moment!</p>
                    <Link to="/upload" className="text-teal-600 font-medium hover:underline">Upload a photo</Link>
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {photos.map((photo) => (
                        <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100 border border-slate-200 cursor-pointer">
                            <img
                                src={photo.image_url}
                                alt={`Photo ${photo.id}`}
                                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                                loading="lazy"
                                onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/300?text=Error+Loading+Image')}
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}