// src/utils/api.ts

import type { PhotoFilter } from '../types';

const API_URL = '/api';

export const api = {
    request: async (endpoint: string, options: RequestInit = {}) => {
        const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };

        if (!(options.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
        }

        const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Server error');
        return data;
    },

    // ── Auth ──────────────────────────────────────────────────────────────────
    auth: {
        register: (body: unknown) =>
            api.request('/auth/sign-up', { method: 'POST', body: JSON.stringify(body) }),
        login: (body: unknown) =>
            api.request('/auth/sign-in', { method: 'POST', body: JSON.stringify(body) }),
    },

    // ── Groups ────────────────────────────────────────────────────────────────
    groups: {
        create: (body: { name: string; description: string; userId: number }) =>
            api.request('/groups/create', { method: 'POST', body: JSON.stringify(body) }),

        getUserGroups: (userId: number) =>
            api.request(`/groups/user/${userId}`),

        getDetails: (groupId: string | number) =>
            api.request(`/groups/${groupId}`),

        getMembers: (groupId: string | number) =>
            api.request(`/groups/${groupId}/members`),

        getInviteLink: (groupId: string | number) =>
            api.request(`/groups/${groupId}/invite`),

        leave: (groupId: string | number, userId: number) =>
            api.request(`/groups/${groupId}/leave`, {
                method: 'POST',
                body: JSON.stringify({ userId }),
            }),

        joinByToken: (token: string, userId: number) =>
            api.request(`/join/${token}`, {
                method: 'POST',
                body: JSON.stringify({ userId }),
            }),
    },

    // ── Photos ────────────────────────────────────────────────────────────────
    photos: {
        /** Upload a single photo via multipart FormData */
        add: (formData: FormData) =>
            api.request('/photos/add', { method: 'POST', body: formData }),

        /** Filtered photo list for a group */
        getByGroup: (
            groupId: string | number,
            filter: PhotoFilter = 'all',
            userId?: number
        ) => {
            const qs = new URLSearchParams({ filter });
            if (userId !== undefined) qs.set('userId', String(userId));
            return api.request(`/photos/group/${groupId}?${qs}`);
        },

        getRecent: (userId: number) =>
            api.request(`/photos/recent/${userId}`),

        /** All photos where a specific user is tagged */
        getByFace: (taggedUserId: number, groupId?: number) => {
            const qs = groupId ? `?groupId=${groupId}` : '';
            return api.request(`/photos/by-face/${taggedUserId}${qs}`);
        },

        /** Face-folder summary for EventScreen */
        getFaceFolders: (groupId: string | number) =>
            api.request(`/photos/faces/${groupId}`),

        /** Trigger a server-side zip and stream it back as a download */
        downloadZip: async (
            groupId: number,
            userId: number,
            filter: PhotoFilter = 'all'
        ): Promise<void> => {
            const res = await fetch(`${API_URL}/photos/download-zip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId, userId, filter }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || 'Download failed');
            }
            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `faceo-photos-${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        },
    },
};
