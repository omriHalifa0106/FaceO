export interface User {
    id: number;
    username: string;
    email: string;
    phone_num?: string;
    profile_image?: string;
}

export interface Group {
    id: number;
    name: string;
    description?: string;
    created_by: number;
    created_at: string;
}

export interface Photo {
    id: number;
    url?: string;       // For frontend consistency
    image_url?: string; // From DB
    group_id: number;
    uploaded_by?: number;
}