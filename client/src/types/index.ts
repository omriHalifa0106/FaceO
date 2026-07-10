// src/types/index.ts

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
    invite_token?: string;
    member_count?: number;
    photo_count?: number;
    created_at: string;
}

export interface Photo {
    id: number;
    group_id: number;
    uploaded_by?: number;
    image_url: string;
    has_faces?: boolean;
    tag_count?: number;
    taken_at?: string;
    uploaded_at: string;
}

export interface Tag {
    id: number;
    photo_id: number;
    user_id?: number;
    tag_type: 'local' | 'guest';
    guest_code?: string;
    tagged_at: string;
}

export interface GroupMember {
    id: number;
    username: string;
    email: string;
    profile_image?: string;
    joined_at: string;
}

/** One row from the /photos/faces/:groupId endpoint */
export interface FaceFolder {
    user_id: number | null;
    username: string;           // real name or "Anonymous_X"
    thumbnail: string | null;
    photo_count: number;
    tag_type: 'local' | 'guest';
    guest_code: string | null;
}

export type PhotoFilter = 'all' | 'mine' | 'group' | 'landscape';
