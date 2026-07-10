// src/types/index.ts

export interface User {
    id: number;
    username: string;
    email: string;
    phone_num?: string;
    profile_image?: string;
    face_embedding?: number[];
    created_at: Date;
}

export interface Group {
    id: number;
    name: string;
    description?: string;
    created_by: number;
    invite_token: string;
    created_at: Date;
}

export interface GroupMember {
    group_id: number;
    user_id: number;
    joined_at: Date;
}

export interface Photo {
    id: number;
    group_id: number;
    uploaded_by: number;
    image_url: string;
    has_faces: boolean;
    taken_at?: Date;
    uploaded_at: Date;
}

export interface Tag {
    id: number;
    photo_id: number;
    user_id?: number;       // null = guest
    tag_type: 'local' | 'guest';
    guest_code?: string;    // e.g. "Anonymous_3"
    face_embedding?: number[];
    tagged_at: Date;
}

export interface FaceCache {
    user_id: number;
    embedding: number[];
    cached_at: Date;
}

/** Shape returned by the Python face-recognition worker */
export interface FaceRecognitionResult {
    /** Detected face region */
    region: { x: number; y: number; w: number; h: number };
    /** 512-dim ArcFace embedding */
    embedding: number[];
    /** Cosine distance to best DB match (undefined if no members in DB) */
    best_distance?: number;
    /** ID of the best-matching group member (undefined if no match < threshold) */
    matched_user_id?: number;
    /** DBSCAN cluster label for unrecognised faces, e.g. "Anonymous_0" */
    cluster_label?: string;
}
