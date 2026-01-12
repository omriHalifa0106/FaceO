export interface User {
    id: number;
    username: string;
    email: string;
    profile_image?: string;
}

export interface Photo {
    id: number;
    group_id: number;
    uploaded_by: number;
    image_url: string;
    created_at: Date;
}