// src/pages/FolderScreen.tsx
//
// Reached from GroupDetails via a "View by Face" button.
// URL: /groups/:groupId/faces
//
// Shows a grid of face thumbnails (one tile per recognised person / guest cluster).
// Clicking a tile opens a sub-view showing every photo that person appears in,
// with a "Download All" button that streams a zip from the server.

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, ImageIcon, User as UserIcon, X } from 'lucide-react';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import type { FaceFolder, Photo } from '../types';

export default function FolderScreen() {
    const { groupId }   = useParams<{ groupId: string }>();
    const { user }      = useAuth();
    const navigate      = useNavigate();

    const [folders,       setFolders]       = useState<FaceFolder[]>([]);
    const [loading,       setLoading]       = useState(true);
    const [activeFolder,  setActiveFolder]  = useState<FaceFolder | null>(null);
    const [folderPhotos,  setFolderPhotos]  = useState<Photo[]>([]);
    const [photosLoading, setPhotosLoading] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [lightbox,      setLightbox]      = useState<Photo | null>(null);

    useEffect(() => {
        if (!groupId) return;
        api.photos.getFaceFolders(groupId)
            .then(setFolders)
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [groupId]);

    const openFolder = useCallback(async (folder: FaceFolder) => {
        setActiveFolder(folder);
        setPhotosLoading(true);
        try {
            let data: Photo[];
            if (folder.tag_type === 'local' && folder.user_id) {
                data = await api.photos.getByFace(folder.user_id, Number(groupId));
            } else {
                // Guest folders: filter by group + guest_code using group photos endpoint
                data = await api.photos.getByGroup(groupId!, 'all');
                // Client-side filter: only photos with this guest_code
                // (server returns tag_count; for a full implementation add a dedicated endpoint)
                // For POC we show the full group with a note
            }
            setFolderPhotos(data);
        } catch (err) {
            console.error('Failed to load folder photos', err);
        } finally {
            setPhotosLoading(false);
        }
    }, [groupId]);

    const handleDownloadAll = async () => {
        if (!groupId || !user || !activeFolder) return;
        setIsDownloading(true);
        try {
            if (activeFolder.tag_type === 'local' && activeFolder.user_id) {
                await api.photos.downloadZip(Number(groupId), activeFolder.user_id, 'mine');
            } else {
                await api.photos.downloadZip(Number(groupId), user.id, 'all');
            }
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : 'Download failed');
        } finally {
            setIsDownloading(false);
        }
    };

    if (loading) return (
        <div className="flex justify-center mt-20">
            <Loader2 className="animate-spin text-teal-600" size={32} />
        </div>
    );

    // ── Sub-view: photos for a specific face ──────────────────────────────────
    if (activeFolder) {
        return (
            <div className="max-w-6xl mx-auto">
                {/* Sub-header */}
                <div className="flex items-center justify-between mb-6">
                    <button
                        onClick={() => { setActiveFolder(null); setFolderPhotos([]); }}
                        className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition"
                    >
                        <ArrowLeft size={18} /> Back to Folders
                    </button>
                    <button
                        onClick={handleDownloadAll}
                        disabled={isDownloading || folderPhotos.length === 0}
                        className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-teal-700 transition disabled:opacity-50"
                    >
                        {isDownloading
                            ? <Loader2 size={15} className="animate-spin" />
                            : <Download size={15} />
                        }
                        Download All
                    </button>
                </div>

                {/* Person header */}
                <div className="flex items-center gap-4 mb-6 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    <div className="w-14 h-14 rounded-full bg-teal-100 overflow-hidden flex items-center justify-center text-teal-700 font-bold text-lg">
                        {activeFolder.thumbnail
                            ? <img src={activeFolder.thumbnail} alt={activeFolder.username} className="w-full h-full object-cover" />
                            : <UserIcon size={24} />
                        }
                    </div>
                    <div>
                        <p className="font-bold text-slate-900 text-lg">{activeFolder.username}</p>
                        <p className="text-slate-500 text-sm">{activeFolder.photo_count} photo{activeFolder.photo_count !== 1 ? 's' : ''}</p>
                    </div>
                </div>

                {photosLoading ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="animate-spin text-teal-600" size={28} />
                    </div>
                ) : folderPhotos.length === 0 ? (
                    <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-200">
                        <ImageIcon size={36} className="mx-auto text-slate-300 mb-2" />
                        <p className="text-slate-500">No photos found</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {folderPhotos.map(photo => (
                            <div
                                key={photo.id}
                                onClick={() => setLightbox(photo)}
                                className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100 border border-slate-200 cursor-pointer"
                            >
                                <img
                                    src={photo.image_url}
                                    alt=""
                                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                                    loading="lazy"
                                    onError={e => (e.currentTarget.src = 'https://placehold.co/300?text=⚠')}
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                            </div>
                        ))}
                    </div>
                )}

                {/* Lightbox */}
                {lightbox && (
                    <div
                        className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
                        onClick={() => setLightbox(null)}
                    >
                        <div
                            className="relative max-w-3xl w-full bg-white rounded-2xl overflow-hidden"
                            onClick={e => e.stopPropagation()}
                        >
                            <button
                                onClick={() => setLightbox(null)}
                                className="absolute top-3 right-3 p-1.5 bg-black/40 text-white rounded-lg z-10"
                            >
                                <X size={18} />
                            </button>
                            <img
                                src={lightbox.image_url}
                                alt="Full"
                                className="w-full max-h-[70vh] object-contain bg-black"
                            />
                            <div className="p-4 flex justify-end">
                                <a
                                    href={lightbox.image_url}
                                    download
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-teal-700"
                                >
                                    <Download size={14} /> Download
                                </a>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── Main folder grid ──────────────────────────────────────────────────────
    return (
        <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-4 mb-8">
                <button
                    onClick={() => navigate(`/groups/${groupId}`)}
                    className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition"
                >
                    <ArrowLeft size={18} />
                </button>
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Photos by Face</h1>
                    <p className="text-slate-500 text-sm">
                        {folders.length} {folders.length === 1 ? 'person' : 'people'} detected
                    </p>
                </div>
            </div>

            {folders.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
                    <UserIcon size={40} className="mx-auto text-slate-300 mb-3" />
                    <h3 className="text-lg font-medium text-slate-900">No faces detected yet</h3>
                    <p className="text-slate-500 text-sm">Upload photos and face recognition will run automatically.</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                    {folders.map((folder, idx) => (
                        <button
                            key={folder.user_id ?? folder.guest_code ?? idx}
                            onClick={() => openFolder(folder)}
                            className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-teal-200 transition group text-left overflow-hidden"
                        >
                            {/* Thumbnail */}
                            <div className="aspect-square bg-slate-100 overflow-hidden">
                                {folder.thumbnail ? (
                                    <img
                                        src={folder.thumbnail}
                                        alt={folder.username}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-teal-50">
                                        <UserIcon size={40} className="text-teal-300" />
                                    </div>
                                )}
                            </div>

                            {/* Label */}
                            <div className="p-3">
                                <p className="font-semibold text-slate-900 truncate text-sm">
                                    {folder.tag_type === 'local' ? folder.username : `Unknown (${folder.username})`}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {folder.photo_count} photo{folder.photo_count !== 1 ? 's' : ''}
                                </p>
                                {folder.tag_type === 'guest' && (
                                    <span className="inline-block mt-1 bg-amber-50 text-amber-700 text-xs px-2 py-0.5 rounded-full">
                                        Guest
                                    </span>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
