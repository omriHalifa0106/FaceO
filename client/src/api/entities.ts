// src/api/entities.ts — FaceO data layer on top of Supabase.
//
// Every function returns Result<T> ({ data, error }) and never throws.
// Biometric data is deliberately NOT reachable from here: face embeddings
// are only read/written by src/lib/faceRecognition.ts and
// src/lib/guestResolution.ts.

import { supabase } from '@/lib/supabaseClient';
import { attempt, type Result } from '@/lib/result';
import type {
  EventGuest as EventGuestRow,
  Group as GroupRow,
  GroupInput,
  GroupMember,
  GroupPerson,
  GroupSummary,
  InvitePreview,
  MemberRole,
  PersonRef,
  Photo as PhotoRow,
  PhotoFilter,
  PhotoInsert,
  Profile,
  ProfileUpdate,
  Tag as TagRow,
  TagWithPerson,
  UUID,
} from '@/types';

/** Explicit profile columns — keeps any future sensitive column out of the app context. */
export const PROFILE_COLUMNS = 'id, full_name, phone, avatar_key, face_enrolled_at, created_at, updated_at';
const GROUP_COLUMNS = 'id, name, description, kind, event_date, location, invite_token, created_by, created_at, updated_at';
const PHOTO_COLUMNS =
  'id, group_id, uploaded_by, storage_key, mime_type, size_bytes, width, height, taken_at, face_status, face_count, has_faces, processed_at, created_at';
const TAG_COLUMNS = 'id, photo_id, group_id, user_id, guest_id, box, det_score, match_distance, source, created_at';

export interface Page {
  limit?: number;
  offset?: number;
}
const DEFAULT_PAGE = 60;

function range({ limit = DEFAULT_PAGE, offset = 0 }: Page = {}): [number, number] {
  return [offset, offset + limit - 1];
}

async function currentUserId(): Promise<UUID> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const id = data.session?.user.id;
  if (!id) throw Object.assign(new Error('You need to sign in first.'), { code: '401' });
  return id;
}

/** PostgREST returns embedded counts as [{ count }]. */
function embeddedCount(value: unknown): number {
  return Array.isArray(value) && value[0] && typeof value[0].count === 'number' ? value[0].count : 0;
}

type RowWith<T> = T & Record<string, unknown>;
type GroupEmbed = GroupRow & { group_members: unknown; photos: unknown };
export type PhotoWithGroup = PhotoRow & { group: Pick<GroupRow, 'id' | 'name'> | null };

/** Strip helper join columns (e.g. `match`) that only exist to filter. */
function stripKey<T>(rows: Array<RowWith<T>>, key: string): T[] {
  return rows.map((row) => {
    const copy = { ...row };
    delete copy[key];
    return copy as T;
  });
}

// =============================================================================
// User (profiles)
// =============================================================================
export const User = {
  me(): Promise<Result<Profile>> {
    return attempt(async () => {
      const uid = await currentUserId();
      const { data, error } = await supabase.from('users').select(PROFILE_COLUMNS).eq('id', uid).single();
      if (error) throw error;
      return data as Profile;
    }, 'Could not load your profile');
  },

  update(patch: ProfileUpdate): Promise<Result<Profile>> {
    return attempt(async () => {
      const uid = await currentUserId();
      const clean: ProfileUpdate = {};
      if (patch.full_name !== undefined) clean.full_name = patch.full_name.trim().slice(0, 100);
      if (patch.phone !== undefined) clean.phone = patch.phone?.trim() || null;
      if (patch.avatar_key !== undefined) clean.avatar_key = patch.avatar_key;
      const { data, error } = await supabase.from('users').update(clean).eq('id', uid).select(PROFILE_COLUMNS).single();
      if (error) throw error;
      return data as Profile;
    }, 'Could not save your profile');
  },
};

// =============================================================================
// Group / Event
// =============================================================================
export const Group = {
  /** Groups the current user belongs to, newest first, with counts and role. */
  list(): Promise<Result<GroupSummary[]>> {
    return attempt(async () => {
      const uid = await currentUserId();
      const { data, error } = await supabase
        .from('group_members')
        .select(`role, group:groups(${GROUP_COLUMNS}, group_members(count), photos(count))`)
        .eq('user_id', uid);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{ role: MemberRole; group: GroupEmbed | null }>;
      return rows
        .filter((row): row is { role: MemberRole; group: GroupEmbed } => !!row.group)
        .map((row) => {
          const { group_members, photos, ...group } = row.group;
          return {
            ...(group as GroupRow),
            member_count: embeddedCount(group_members),
            photo_count: embeddedCount(photos),
            my_role: row.role as MemberRole,
          };
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    }, 'Could not load your groups');
  },

  get(groupId: UUID): Promise<Result<GroupSummary>> {
    return attempt(async () => {
      const uid = await currentUserId();
      const { data, error } = await supabase
        .from('groups')
        .select(`${GROUP_COLUMNS}, group_members(count), photos(count), me:group_members!inner(role)`)
        .eq('id', groupId)
        .eq('me.user_id', uid)
        .single();
      if (error) throw error;
      const { group_members, photos, me, ...group } = data as unknown as GroupEmbed & { me: Array<{ role: MemberRole }> };
      return {
        ...(group as GroupRow),
        member_count: embeddedCount(group_members),
        photo_count: embeddedCount(photos),
        my_role: (me?.[0]?.role ?? 'member') as MemberRole,
      };
    }, 'Group not found');
  },

  create(input: GroupInput): Promise<Result<GroupRow>> {
    return attempt(async () => {
      const { data, error } = await supabase.rpc('create_group', {
        p_name: input.name,
        p_description: input.description ?? null,
        p_kind: input.kind ?? 'event',
        p_event_date: input.event_date || null,
        p_location: input.location ?? null,
      });
      if (error) throw error;
      return data as GroupRow;
    }, 'Could not create the group');
  },

  update(groupId: UUID, patch: Partial<GroupInput>): Promise<Result<GroupRow>> {
    return attempt(async () => {
      const clean: Record<string, unknown> = {};
      if (patch.name !== undefined) clean.name = patch.name.trim();
      if (patch.description !== undefined) clean.description = patch.description?.trim() || null;
      if (patch.kind !== undefined) clean.kind = patch.kind;
      if (patch.event_date !== undefined) clean.event_date = patch.event_date || null;
      if (patch.location !== undefined) clean.location = patch.location?.trim() || null;
      const { data, error } = await supabase.from('groups').update(clean).eq('id', groupId).select(GROUP_COLUMNS).single();
      if (error) throw error;
      return data as GroupRow;
    }, 'Could not update the group');
  },

  /**
   * Deletes the group and its rows. R2 objects are removed through the
   * r2-presign function first so no files are orphaned.
   */
  remove(groupId: UUID): Promise<Result<true>> {
    return attempt(async () => {
      const { data: photos, error } = await supabase.from('photos').select('id').eq('group_id', groupId);
      if (error) throw error;
      for (const p of photos ?? []) {
        const { error: fnError } = await supabase.functions.invoke('r2-presign', {
          body: { action: 'delete', photoId: p.id },
        });
        if (fnError) throw await functionError(fnError);
      }
      const { error: delError } = await supabase.from('groups').delete().eq('id', groupId);
      if (delError) throw delError;
      return true as const;
    }, 'Could not delete the group');
  },

  members(groupId: UUID): Promise<Result<GroupMember[]>> {
    return attempt(async () => {
      const { data, error } = await supabase
        .from('group_members')
        .select('group_id, user_id, role, joined_at, user:users(id, full_name, avatar_key, face_enrolled_at)')
        .eq('group_id', groupId)
        .order('joined_at');
      if (error) throw error;
      return (data ?? []) as unknown as GroupMember[];
    }, 'Could not load members');
  },

  setMemberRole(groupId: UUID, userId: UUID, role: MemberRole): Promise<Result<true>> {
    return attempt(async () => {
      const { error } = await supabase.from('group_members').update({ role }).eq('group_id', groupId).eq('user_id', userId);
      if (error) throw error;
      return true as const;
    }, 'Could not change the role');
  },

  removeMember(groupId: UUID, userId: UUID): Promise<Result<true>> {
    return attempt(async () => {
      const { data, error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .select('user_id');
      if (error) throw error;
      if (!data?.length) throw Object.assign(new Error('You are not allowed to remove this member.'), { code: '42501' });
      return true as const;
    }, 'Could not remove the member');
  },

  async leave(groupId: UUID): Promise<Result<true>> {
    const uid = await attempt(currentUserId);
    if (uid.error) return uid;
    return Group.removeMember(groupId, uid.data);
  },

  invitePreview(token: string): Promise<Result<InvitePreview | null>> {
    return attempt(async () => {
      const { data, error } = await supabase.rpc('get_invite_preview', { p_token: token });
      if (error) throw error;
      return ((data ?? [])[0] as InvitePreview | undefined) ?? null;
    }, 'Could not load the invitation');
  },

  /** Joins via invite token; the DB also re-attributes matching guest faces. */
  join(token: string): Promise<Result<UUID>> {
    return attempt(async () => {
      const { data, error } = await supabase.rpc('join_group_by_token', { p_token: token });
      if (error) throw error;
      return data as UUID;
    }, 'Could not join the group');
  },

  regenerateInvite(groupId: UUID): Promise<Result<string>> {
    return attempt(async () => {
      const { data, error } = await supabase.rpc('regenerate_invite_token', { p_group_id: groupId });
      if (error) throw error;
      return data as string;
    }, 'Could not reset the invite link');
  },

  inviteUrl(token: string): string {
    return `${window.location.origin}/join/${token}`;
  },

  /** People "folders": members and guests with photo counts. */
  people(groupId: UUID): Promise<Result<GroupPerson[]>> {
    return attempt(async () => {
      const { data, error } = await supabase.rpc('get_group_people', { p_group_id: groupId });
      if (error) throw error;
      return ((data ?? []) as GroupPerson[]).map((p) => ({ ...p, photo_count: Number(p.photo_count) }));
    }, 'Could not load people');
  },
};

// =============================================================================
// Photo
// =============================================================================
export const Photo = {
  listByGroup(groupId: UUID, filter: PhotoFilter = 'all', page?: Page): Promise<Result<PhotoRow[]>> {
    return attempt(async () => {
      const [from, to] = range(page);
      if (filter === 'mine' || filter === 'with_others') {
        const uid = await currentUserId();
        let q = supabase
          .from('photos')
          .select(`${PHOTO_COLUMNS}, match:tags!inner(user_id)`)
          .eq('group_id', groupId)
          .eq('match.user_id', uid);
        if (filter === 'with_others') q = q.gte('face_count', 2);
        const { data, error } = await q.order('created_at', { ascending: false }).range(from, to);
        if (error) throw error;
        return stripKey<PhotoRow>((data ?? []) as unknown as RowWith<PhotoRow>[], 'match');
      }

      let q = supabase.from('photos').select(PHOTO_COLUMNS).eq('group_id', groupId);
      if (filter === 'no_faces') q = q.eq('face_status', 'done').eq('face_count', 0);
      const { data, error } = await q.order('created_at', { ascending: false }).range(from, to);
      if (error) throw error;
      return (data ?? []) as PhotoRow[];
    }, 'Could not load photos');
  },

  /** Photos of one person (member or guest) inside a group. */
  listByPerson(groupId: UUID, person: PersonRef, page?: Page): Promise<Result<PhotoRow[]>> {
    return attempt(async () => {
      const [from, to] = range(page);
      let q = supabase
        .from('photos')
        .select(`${PHOTO_COLUMNS}, match:tags!inner(user_id, guest_id)`)
        .eq('group_id', groupId);
      q = 'userId' in person ? q.eq('match.user_id', person.userId) : q.eq('match.guest_id', person.guestId);
      const { data, error } = await q.order('created_at', { ascending: false }).range(from, to);
      if (error) throw error;
      return stripKey<PhotoRow>((data ?? []) as unknown as RowWith<PhotoRow>[], 'match');
    }, 'Could not load photos');
  },

  /** Every photo, in all my groups, in which I was recognised. */
  listMine(page?: Page): Promise<Result<PhotoWithGroup[]>> {
    return attempt(async () => {
      const uid = await currentUserId();
      const [from, to] = range(page);
      const { data, error } = await supabase
        .from('photos')
        .select(`${PHOTO_COLUMNS}, group:groups(id, name), match:tags!inner(user_id)`)
        .eq('match.user_id', uid)
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) throw error;
      return stripKey<PhotoWithGroup>((data ?? []) as unknown as RowWith<PhotoWithGroup>[], 'match');
    }, 'Could not load your photos');
  },

  /** Latest photos across all my groups (RLS limits rows to my groups). */
  listRecent(limit = 12): Promise<Result<PhotoWithGroup[]>> {
    return attempt(async () => {
      const { data, error } = await supabase
        .from('photos')
        .select(`${PHOTO_COLUMNS}, group:groups(id, name)`)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as PhotoWithGroup[];
    }, 'Could not load recent photos');
  },

  /** Photos whose faces still need to be processed (pending or failed). */
  listUnprocessed(groupId: UUID, limit = 200): Promise<Result<PhotoRow[]>> {
    return attempt(async () => {
      const { data, error } = await supabase
        .from('photos')
        .select(PHOTO_COLUMNS)
        .eq('group_id', groupId)
        .neq('face_status', 'done')
        .order('created_at')
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as PhotoRow[];
    }, 'Could not load unprocessed photos');
  },

  get(photoId: UUID): Promise<Result<PhotoRow>> {
    return attempt(async () => {
      const { data, error } = await supabase.from('photos').select(PHOTO_COLUMNS).eq('id', photoId).single();
      if (error) throw error;
      return data as PhotoRow;
    }, 'Photo not found');
  },

  /** Insert the DB row for a file that is already in R2 (see lib/storage.ts). */
  create(row: PhotoInsert): Promise<Result<PhotoRow>> {
    return attempt(async () => {
      const { data, error } = await supabase.from('photos').insert(row).select(PHOTO_COLUMNS).single();
      if (error) throw error;
      return data as PhotoRow;
    }, 'Could not save the photo');
  },

  /** Deletes the row (RLS: uploader or admin) and its R2 object, via the edge function. */
  remove(photoId: UUID): Promise<Result<true>> {
    return attempt(async () => {
      const { error } = await supabase.functions.invoke('r2-presign', { body: { action: 'delete', photoId } });
      if (error) throw await functionError(error);
      return true as const;
    }, 'Could not delete the photo');
  },
};

// =============================================================================
// EventGuest (unidentified people in an event)
// =============================================================================
export const EventGuest = {
  list(groupId: UUID): Promise<Result<EventGuestRow[]>> {
    return attempt(async () => {
      const { data, error } = await supabase
        .from('event_guests')
        .select('id, group_id, guest_number, display_name, created_at, updated_at')
        .eq('group_id', groupId)
        .order('guest_number');
      if (error) throw error;
      return (data ?? []) as EventGuestRow[];
    }, 'Could not load guests');
  },

  rename(guestId: UUID, displayName: string | null): Promise<Result<EventGuestRow>> {
    return attempt(async () => {
      const { data, error } = await supabase
        .from('event_guests')
        .update({ display_name: displayName?.trim() || null })
        .eq('id', guestId)
        .select('id, group_id, guest_number, display_name, created_at, updated_at')
        .single();
      if (error) throw error;
      return data as EventGuestRow;
    }, 'Could not rename the guest');
  },

  /** Move all faces of a guest to a member (identification) or into another guest. */
  merge(guestId: UUID, target: PersonRef): Promise<Result<number>> {
    return attempt(async () => {
      const { data, error } = await supabase.rpc('merge_guest', {
        p_guest_id: guestId,
        p_user_id: 'userId' in target ? target.userId : null,
        p_into_guest_id: 'guestId' in target ? target.guestId : null,
      });
      if (error) throw error;
      return data as number;
    }, 'Could not merge');
  },

  /** Admin only: removes the guest; its faces become unassigned. */
  remove(guestId: UUID): Promise<Result<true>> {
    return attempt(async () => {
      const { data, error } = await supabase.from('event_guests').delete().eq('id', guestId).select('id');
      if (error) throw error;
      if (!data?.length) throw Object.assign(new Error('Only group admins can delete guests.'), { code: '42501' });
      return true as const;
    }, 'Could not delete the guest');
  },
};

// =============================================================================
// Tag (a detected face and who it belongs to)
// =============================================================================
export const Tag = {
  listByPhoto(photoId: UUID): Promise<Result<TagWithPerson[]>> {
    return attempt(async () => {
      const { data, error } = await supabase
        .from('tags')
        // tags has two FKs to users (user_id, assigned_by): name the one we mean.
        .select(
          `${TAG_COLUMNS}, user:users!tags_user_id_fkey(id, full_name, avatar_key), guest:event_guests(id, guest_number, display_name)`,
        )
        .eq('photo_id', photoId)
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as unknown as TagWithPerson[];
    }, 'Could not load tags');
  },

  listByGroup(groupId: UUID): Promise<Result<TagRow[]>> {
    return attempt(async () => {
      const { data, error } = await supabase.from('tags').select(TAG_COLUMNS).eq('group_id', groupId);
      if (error) throw error;
      return (data ?? []) as TagRow[];
    }, 'Could not load tags');
  },

  /** Assign a face to a member or guest; pass null to mark it as unknown. */
  assign(tagId: UUID, target: PersonRef | null): Promise<Result<true>> {
    return attempt(async () => {
      const { error } = await supabase.rpc('assign_tag', {
        p_tag_id: tagId,
        p_user_id: target && 'userId' in target ? target.userId : null,
        p_guest_id: target && 'guestId' in target ? target.guestId : null,
      });
      if (error) throw error;
      return true as const;
    }, 'Could not update the tag');
  },

  /** "This is someone else": move a single face to a brand-new guest. */
  splitToNewGuest(tagId: UUID): Promise<Result<UUID>> {
    return attempt(async () => {
      const { data, error } = await supabase.rpc('split_tag_to_new_guest', { p_tag_id: tagId });
      if (error) throw error;
      return data as UUID;
    }, 'Could not create a new guest');
  },

  /** Remove a face tag (tagged person, uploader or admin). */
  remove(tagId: UUID): Promise<Result<true>> {
    return attempt(async () => {
      const { error } = await supabase.rpc('delete_tag', { p_tag_id: tagId });
      if (error) throw error;
      return true as const;
    }, 'Could not remove the tag');
  },
};

// =============================================================================
// Helpers
// =============================================================================

/** supabase.functions.invoke wraps HTTP errors; pull out the JSON { error } body. */
export async function functionError(err: unknown): Promise<Error & { code?: string }> {
  // FunctionsFetchError = no readable HTTP response at all (function not deployed,
  // crashed at boot, or blocked by CORS). The browser hides the real status.
  if ((err as { name?: string })?.name === 'FunctionsFetchError') {
    return Object.assign(
      new Error('Could not reach the upload service. Check that the r2-presign function is deployed and ALLOWED_ORIGINS includes this site.'),
      { code: 'FUNCTION_UNREACHABLE' },
    );
  }
  const ctx = (err as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return Object.assign(new Error(String(body.error)), { code: String(ctx.status) });
    } catch {
      /* not JSON */
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}
