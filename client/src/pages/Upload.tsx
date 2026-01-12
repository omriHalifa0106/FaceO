import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Upload as UploadIcon, X, Check, Loader2, ImagePlus } from "lucide-react";
import { api } from "../utils/api";
import { useAuth } from "../context/AuthContext";
import type { Group } from "../types";

export default function Upload() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [groups, setGroups] = useState<Group[]>([]);
    const [selectedGroup, setSelectedGroup] = useState<string>("");
    const [selectedFile, setSelectedFile] = useState<File | null>(null); // שמירת הקובץ
    const [previewUrl, setPreviewUrl] = useState<string | null>(null); // תצוגה מקדימה
    const [isUploading, setIsUploading] = useState(false);

    useEffect(() => {
        const fetchGroups = async () => {
            if (user) {
                try {
                    const data = await api.groups.getUserGroups(user.id);
                    setGroups(data);
                } catch (error) {
                    console.error("Failed to load groups");
                }
            }
        };
        fetchGroups();
    }, [user]);

    // טיפול בבחירת קובץ
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setSelectedFile(file);
            // יצירת URL זמני לתצוגה מקדימה
            setPreviewUrl(URL.createObjectURL(file));
        }
    };

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedGroup || !selectedFile || !user) return;

        setIsUploading(true);
        try {
            // יצירת FormData לשליחת קובץ
            const formData = new FormData();
            formData.append('photo', selectedFile); // 'photo' חייב להתאים לשם בשרת (multer)
            formData.append('groupId', selectedGroup);
            formData.append('userId', user.id.toString());

            await api.photos.add(formData);
            alert("Photo uploaded successfully!");
            navigate(`/groups/${selectedGroup}`); // מעבר לדף הקבוצה
        } catch (error) {
            console.error(error);
            alert("Failed to upload photo");
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto">
            <h1 className="text-3xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <UploadIcon className="text-teal-600" /> Upload Photo
            </h1>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
                <form onSubmit={handleUpload} className="space-y-6">

                    {/* Select Group */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Select Group</label>
                        <select
                            value={selectedGroup}
                            onChange={(e) => setSelectedGroup(e.target.value)}
                            className="w-full border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-teal-500 outline-none bg-white"
                            required
                        >
                            <option value="">-- Choose a Group --</option>
                            {groups.map((g) => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* File Input (Drag and Drop style) */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Choose Photo</label>
                        <div className={`border-2 border-dashed rounded-xl p-8 text-center ${previewUrl ? 'border-teal-500 bg-teal-50' : 'border-slate-300 hover:border-teal-400'}`}>
                            <input
                                type="file"
                                accept="image/*"
                                onChange={handleFileSelect}
                                className="hidden"
                                id="file-upload"
                            />
                            <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center justify-center h-full">
                                {previewUrl ? (
                                    <img src={previewUrl} alt="Preview" className="max-h-64 rounded-lg shadow-sm object-contain" />
                                ) : (
                                    <>
                                        <ImagePlus size={48} className="text-slate-400 mb-4" />
                                        <p className="text-slate-600 font-medium">Click to upload or drag and drop</p>
                                        <p className="text-xs text-slate-400 mt-1">PNG, JPG up to 10MB</p>
                                    </>
                                )}
                            </label>
                        </div>
                    </div>

                    <div className="flex gap-4 pt-4">
                        <button
                            type="button"
                            onClick={() => navigate(-1)}
                            className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-xl font-bold hover:bg-slate-200 transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isUploading || !selectedGroup || !selectedFile}
                            className="flex-1 bg-teal-600 text-white py-3 rounded-xl font-bold hover:bg-teal-700 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isUploading ? <Loader2 className="animate-spin" /> : <Check />}
                            Upload Photo
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}