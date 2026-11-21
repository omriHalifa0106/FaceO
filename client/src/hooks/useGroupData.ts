// src/hooks/useGroupData.ts — group + members + guests, shared by group pages
import { useMemo } from 'react';
import { EventGuest, Group } from '@/api/entities';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/context/AuthContext';
import type { ViewerContext } from '@/components/PhotoViewer';
import type { UUID } from '@/types';

export function useGroupData(groupId: UUID) {
  const { user } = useAuth();
  const group = useAsync(() => Group.get(groupId), [groupId]);
  const members = useAsync(() => Group.members(groupId), [groupId]);
  const guests = useAsync(() => EventGuest.list(groupId), [groupId]);

  const viewerContext = useMemo<ViewerContext | null>(
    () =>
      user && group.data
        ? { myUserId: user.id, myRole: group.data.my_role, members: members.data ?? [], guests: guests.data ?? [] }
        : null,
    [user, group.data, members.data, guests.data],
  );

  const isAdmin = group.data?.my_role === 'owner' || group.data?.my_role === 'admin';

  return { group, members, guests, viewerContext, isAdmin };
}
