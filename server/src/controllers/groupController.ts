/**
 * groupController.ts
 *
 * Extended group management:
 *  - createGroup       (already in dataController, replicated here for clarity)
 *  - joinGroupByToken  — called when a user clicks an invite link
 *  - getGroupMembers   — returns the user list for the event screen header
 *  - leaveGroup        — member removes themselves
 *  - getGroupDetails   — single group with member count
 *  - generateInviteLink
 */

import { Request, Response } from 'express';
import db from '../config/db';
import { promoteGuestTagsForNewMember } from '../services/faceRecognitionService';

// ─── Create Group ─────────────────────────────────────────────────────────────

export const createGroup = async (req: Request, res: Response): Promise<void> => {
    const { name, description, userId } = req.body;
    try {
        const result = await db.query(
            `INSERT INTO groups (name, description, created_by)
             VALUES ($1, $2, $3) RETURNING *`,
            [name, description, userId]
        );
        const newGroup = result.rows[0];
        // Creator is automatically a member
        await db.query(
            'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [newGroup.id, userId]
        );
        res.status(201).json({ success: true, group: newGroup });
    } catch (error) {
        console.error('Create Group Error:', error);
        res.status(500).json({ message: 'Error creating group' });
    }
};

// ─── Get User Groups ──────────────────────────────────────────────────────────

export const getUserGroups = async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params;
    try {
        const result = await db.query(
            `SELECT DISTINCT g.*,
                    COUNT(DISTINCT gm2.user_id) AS member_count,
                    COUNT(DISTINCT p.id)         AS photo_count
             FROM groups g
             LEFT JOIN group_members gm  ON g.id = gm.group_id  AND gm.user_id = $1
             LEFT JOIN group_members gm2 ON g.id = gm2.group_id
             LEFT JOIN photos p          ON g.id = p.group_id
             WHERE g.created_by = $1 OR gm.user_id = $1
             GROUP BY g.id
             ORDER BY g.created_at DESC`,
            [userId]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Get User Groups Error:', error);
        res.status(500).json({ message: 'Error fetching user groups' });
    }
};

// ─── Get Group Details ────────────────────────────────────────────────────────

export const getGroupDetails = async (req: Request, res: Response): Promise<void> => {
    const { groupId } = req.params;
    try {
        const result = await db.query(
            `SELECT g.*,
                    COUNT(DISTINCT gm.user_id) AS member_count,
                    COUNT(DISTINCT p.id)        AS photo_count
             FROM groups g
             LEFT JOIN group_members gm ON g.id = gm.group_id
             LEFT JOIN photos p         ON g.id = p.group_id
             WHERE g.id = $1
             GROUP BY g.id`,
            [groupId]
        );
        if (result.rows.length === 0) {
            res.status(404).json({ message: 'Group not found' });
            return;
        }
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Get Group Details Error:', error);
        res.status(500).json({ message: 'Error fetching group details' });
    }
};

// ─── Get Group Members ────────────────────────────────────────────────────────

export const getGroupMembers = async (req: Request, res: Response): Promise<void> => {
    const { groupId } = req.params;
    try {
        const result = await db.query(
            `SELECT u.id, u.username, u.email, u.profile_image, gm.joined_at
             FROM group_members gm
             JOIN users u ON gm.user_id = u.id
             WHERE gm.group_id = $1
             ORDER BY gm.joined_at ASC`,
            [groupId]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Get Group Members Error:', error);
        res.status(500).json({ message: 'Error fetching group members' });
    }
};

// ─── Join Group by Invite Token ───────────────────────────────────────────────

export const joinGroupByToken = async (req: Request, res: Response): Promise<void> => {
    const { token } = req.params;
    const { userId } = req.body;

    if (!userId) {
        res.status(400).json({ message: 'userId is required' });
        return;
    }

    try {
        // Find the group
        const groupRes = await db.query(
            'SELECT * FROM groups WHERE invite_token = $1',
            [token]
        );
        if (groupRes.rows.length === 0) {
            res.status(404).json({ message: 'Invalid or expired invite link' });
            return;
        }
        const group = groupRes.rows[0];

        // Check if already a member
        const existing = await db.query(
            'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
            [group.id, userId]
        );
        if (existing.rows.length > 0) {
            res.status(200).json({ success: true, group, alreadyMember: true });
            return;
        }

        // Add as member
        await db.query(
            'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)',
            [group.id, userId]
        );

        res.status(200).json({ success: true, group });

        // Async: promote any guest tags that match this new member
        setImmediate(async () => {
            try {
                await promoteGuestTagsForNewMember(Number(userId), group.id);
            } catch (err) {
                console.error('[joinGroup] Guest promotion error:', err);
            }
        });

    } catch (error) {
        console.error('Join Group Error:', error);
        res.status(500).json({ message: 'Error joining group' });
    }
};

// ─── Generate / Get Invite Link ───────────────────────────────────────────────

export const getInviteLink = async (req: Request, res: Response): Promise<void> => {
    const { groupId } = req.params;
    try {
        const result = await db.query(
            'SELECT invite_token FROM groups WHERE id = $1',
            [groupId]
        );
        if (result.rows.length === 0) {
            res.status(404).json({ message: 'Group not found' });
            return;
        }
        const { invite_token } = result.rows[0];
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const inviteUrl = `${baseUrl}/join/${invite_token}`;
        res.status(200).json({ inviteUrl, token: invite_token });
    } catch (error) {
        console.error('Get Invite Link Error:', error);
        res.status(500).json({ message: 'Error generating invite link' });
    }
};

// ─── Leave Group ──────────────────────────────────────────────────────────────

export const leaveGroup = async (req: Request, res: Response): Promise<void> => {
    const { groupId } = req.params;
    const { userId } = req.body;

    try {
        // Cannot leave if you are the creator
        const groupRes = await db.query('SELECT created_by FROM groups WHERE id = $1', [groupId]);
        if (groupRes.rows[0]?.created_by === Number(userId)) {
            res.status(403).json({ message: 'Group owner cannot leave the group' });
            return;
        }

        await db.query(
            'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
            [groupId, userId]
        );
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Leave Group Error:', error);
        res.status(500).json({ message: 'Error leaving group' });
    }
};
