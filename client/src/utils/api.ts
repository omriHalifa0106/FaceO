const API_URL = '/api';

export const api = {
    // עדכון הפונקציה הבסיסית לתמיכה ב-FormData
    request: async (endpoint: string, options: RequestInit = {}) => {
        // התיקון: אנחנו אומרים ל-TS להתייחס לזה כאל אובייקט רגיל (any)
        const headers: any = { ...options.headers };

        // אם הגוף הוא לא קובץ (FormData), נגדיר שאנחנו שולחים JSON
        if (!(options.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
        }

        const res = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Server error');
        return data;
    },

    auth: {
        register: (body: any) => api.request('/auth/sign-up', { method: 'POST', body: JSON.stringify(body) }),
        login: (body: any) => api.request('/auth/sign-in', { method: 'POST', body: JSON.stringify(body) }),
    },

    groups: {
        create: (body: any) => api.request('/groups/create', { method: 'POST', body: JSON.stringify(body) }),
        getUserGroups: (userId: number) => api.request(`/groups/user/${userId}`),
        getDetails: (groupId: string) => api.request(`/groups/${groupId}`), // חדש
    },

    photos: {
        // שינוי: מקבל FormData במקום אובייקט
        add: (formData: FormData) => api.request('/photos/add', { method: 'POST', body: formData }),
        getByGroup: (groupId: string | number) => api.request(`/photos/group/${groupId}`),
        getRecent: (userId: number) => api.request(`/photos/recent/${userId}`), // חדש
    }
};