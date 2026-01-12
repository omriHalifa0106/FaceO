// src/pages/MyGallery.tsx
import { useState, useEffect } from "react";
import { Image as ImageIcon, Loader2 } from "lucide-react";
import { api } from "../utils/api";
import { useAuth } from "../context/AuthContext";
import type { Group, Photo } from "../types";

export default function MyGallery() {
    const { user } = useAuth();
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchAllPhotos = async () => {
            if (!user) return;
            try {
                // 1. Get all groups
                const myGroups = await api.groups.getUserGroups(user.id);

                // 2. Fetch photos for each group
                const photosPromises = myGroups.map((g: Group) => api.photos.getByGroup(g.id));
                const results = await Promise.all(photosPromises);

                // 3. Flatten array
                const allPhotos = results.flat();
                setPhotos(allPhotos);
            } catch (error) {
                console.error("Error fetching gallery", error);
            } finally {
                setLoading(false);
            }
        };

        fetchAllPhotos();
    }, [user]);

    if (loading) return <div className="flex justify-center mt-20"><Loader2 className="animate-spin text-teal-600" /></div>;

    return (
        <div className="max-w-6xl mx-auto">
            <h1 className="text-3xl font-bold text-slate-900 mb-2 flex items-center gap-3">
                <ImageIcon className="text-teal-600" /> My Gallery
            </h1>
            <p className="text-slate-500 mb-8">All photos from your groups</p>

            {photos.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-2xl shadow-sm border border-slate-100">
                    <ImageIcon size={48} className="mx-auto text-slate-300 mb-4" />
                    <h3 className="text-xl font-medium text-slate-900">No photos yet</h3>
                    <p className="text-slate-500">Photos uploaded to your groups will appear here.</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {photos.map((photo) => (
                        <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100">
                            <img
                                src={photo.url || photo.image_url} // Handle different DB field names
                                alt={`Photo ${photo.id}`}
                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}