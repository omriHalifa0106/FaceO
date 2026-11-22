// src/types/index.ts — row shapes returned by the data layer (mirror the SQL schema)

export type UUID = string;

/** public.users — never contains biometric data. */
export interface Profile {
  id: UUID;
  full_name: string;
  phone: string | null;
  avatar_key: string | null;
  face_enrolled_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ProfileUpdate = Partial<Pick<Profile, 'full_name' | 'phone' | 'avatar_key'>>;

export type GroupKind = 'event' | 'group';
export type MemberRole = 'owner' | 'admin' | 'member';

export interface Group {
  id: UUID;
  name: string;
  description: string | null;
  kind: GroupKind;
  event_date: string | null;
  location: string | null;
  invite_token: string;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface GroupSummary extends Group {
  member_count: number;
  photo_count: number;
  my_role: MemberRole;
}

export interface GroupInput {
  name: string;
  description?: string | null;
  kind?: GroupKind;
  event_date?: string | null;
  location?: string | null;
}

export interface GroupMember {
  group_id: UUID;
  user_id: UUID;
  role: MemberRole;
  joined_at: string;
  user: Pick<Profile, 'id' | 'full_name' | 'avatar_key' | 'face_enrolled_at'> | null;
}

export interface InvitePreview {
  group_id: UUID;
  name: string;
  kind: GroupKind;
  event_date: string | null;
  member_count: number;
  is_member: boolean;
}

export type FaceStatus = 'pending' | 'done' | 'failed';

export interface Photo {
  id: UUID;
  group_id: UUID;
  uploaded_by: UUID | null;
  storage_key: string;
  /** Small JPEG for grids (null until generated). */
  thumb_key: string | null;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  taken_at: string | null;
  face_status: FaceStatus;
  face_count: number;
  has_faces: boolean;
  processed_at: string | null;
  created_at: string;
}

export interface PhotoInsert {
  group_id: UUID;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  taken_at?: string | null;
}

/** all = everything, mine = I appear, with_others = I appear with someone else, no_faces = scenery */
export type PhotoFilter = 'all' | 'mine' | 'with_others' | 'no_faces';

/** Normalised face box, all values 0..1 relative to the image. */
export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EventGuest {
  id: UUID;
  group_id: UUID;
  guest_number: number;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: UUID;
  photo_id: UUID;
  group_id: UUID;
  user_id: UUID | null;
  guest_id: UUID | null;
  box: FaceBox;
  det_score: number | null;
  match_distance: number | null;
  source: 'auto' | 'manual';
  created_at: string;
}

export interface TagWithPerson extends Tag {
  user: Pick<Profile, 'id' | 'full_name' | 'avatar_key'> | null;
  guest: Pick<EventGuest, 'id' | 'guest_number' | 'display_name'> | null;
}

/** One "folder" in a group's People view (from get_group_people). */
export interface GroupPerson {
  kind: 'member' | 'guest';
  user_id: UUID | null;
  guest_id: UUID | null;
  name: string;
  avatar_key: string | null;
  photo_count: number;
  sample_storage_key: string | null;
  sample_thumb_key: string | null;
  sample_box: FaceBox | null;
}

export type PersonRef = { userId: UUID } | { guestId: UUID };
