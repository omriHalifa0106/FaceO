/**
 * photoController.ts
 *
 * Handles:
 * - addPhoto        — save file, queue face recognition, return photo record
 * - getGroupPhotos  — list with optional filter query param
 * - getRecentPhotos — last 12 photos across user's groups
 * - downloadZip     — build a zip on-server from filtered photos and stream it
 * - getPhotosByFace — return all photos tagged with a specific user (folder view)
 */

import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import db from '../config/db';
import { recogniseAndTagPhoto } from '../services/faceRecognitionService';

// ─── Add Photo ────────────────────────────────────────────────────────────────

export const addPhoto = async (req: Request, res: Response): Promise<void> => {
    const { groupId, userId } = req.body;
    const file = req.file;

    if (!file) {
        res.status(400).json({ message: 'No file uploaded' });
        return;
    }
    if (!groupId || !userId) {
        res.status(400).json({ message: 'groupId and userId are required' });
        return;
    }

    // Build a publicly accessible URL for the stored file
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${file.filename}`;
    const diskPath = file.path; // absolute path on server disk

    try {
        // 1. Persist photo record
        const result = await db.query(
            `INSERT INTO photos (group_id, uploaded_by, image_url, taken_at, uploaded_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             RETURNING *`,
            [groupId, userId, imageUrl]
        );
        const photo = result.rows[0];

        res.status(201).json({ success: true, photo });

        // 2. Run face recognition asynchronously (don't block the HTTP response)
        setImmediate(async () => {
            try {
                await recogniseAndTagPhoto(photo.id, diskPath, Number(groupId));
            } catch (err) {
                console.error('[addPhoto] Face recognition failed:', err);
            }
        });

    } catch (error) {
        console.error('Add Photo Error:', error);
        res.status(500).json({ message: 'Error adding photo' });
    }
};

// ─── Get Group Photos (with filters) ─────────────────────────────────────────
//
// Filter query param: ?filter=mine|group|landscape|all  (default: all)
// When filter = mine   → only photos where current user is tagged
// When filter = group  → photos where current user + at least one other person
// When filter = landscape → photos with has_faces = false
// When filter = all    → all photos in the group

export const getGroupPhotos = async (req: Request, res: Response): Promise<void> => {
    const { groupId } = req.params;
    const { filter = 'all', userId } = req.query as { filter?: string; userId?: string };

    try {
        let query: string;
        let params: (string | number)[];

        switch (filter) {
            case 'mine':
                // Only photos where the requesting user is tagged as 'local'
                query = `
                    SELECT DISTINCT p.*
                    FROM photos p
                    JOIN tags t ON t.photo_id = p.id
                    WHERE p.group_id = $1
                      AND t.user_id  = $2
                      AND t.tag_type = 'local'
                    ORDER BY p.uploaded_at DESC
                `;
                params = [groupId as string, userId as string];
                break;

            case 'group':
                // Photos where the user appears alongside at least one other tagged person
                query = `
                    SELECT DISTINCT p.*
                    FROM photos p
                    JOIN tags t1 ON t1.photo_id = p.id AND t1.user_id = $2
                    JOIN tags t2 ON t2.photo_id = p.id AND t2.user_id <> $2
                    WHERE p.group_id = $1
                    ORDER BY p.uploaded_at DESC
                `;
                params = [groupId as string, userId as string];
                break;

            case 'landscape':
                // No faces detected
                query = `
                    SELECT *
                    FROM photos
                    WHERE group_id = $1
                      AND has_faces = FALSE
                    ORDER BY uploaded_at DESC
                `;
                params = [groupId as string];
                break;

            default: // 'all'
                query = `
                    SELECT *
                    FROM photos
                    WHERE group_id = $1
                    ORDER BY uploaded_at DESC
                `;
                params = [groupId as string];
        }

        const result = await db.query(query, params);

        // Attach tag summary to each photo (count of tagged users)
        const photoIds = result.rows.map((p: { id: number }) => p.id);
        let tagCounts: Record<number, number> = {};

        if (photoIds.length > 0) {
            const tagRes = await db.query(
                `SELECT photo_id, COUNT(*) AS count
                 FROM tags
                 WHERE photo_id = ANY($1)
                 GROUP BY photo_id`,
                [photoIds]
            );
            tagCounts = Object.fromEntries(
                tagRes.rows.map((r: { photo_id: number; count: string }) => [r.photo_id, Number(r.count)])
            );
        }

        const photosWithCounts = result.rows.map((p: { id: number }) => ({
            ...p,
            tag_count: tagCounts[p.id] ?? 0,
        }));

        res.status(200).json(photosWithCounts);
    } catch (error) {
        console.error('Get Photos Error:', error);
        res.status(500).json({ message: 'Error fetching photos' });
    }
};

// ─── Get Recent Photos ────────────────────────────────────────────────────────

export const getRecentPhotos = async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params;
    try {
        const result = await db.query(
            `SELECT DISTINCT p.*
             FROM photos p
             JOIN group_members gm ON p.group_id = gm.group_id
             WHERE gm.user_id = $1
             ORDER BY p.uploaded_at DESC
             LIMIT 12`,
            [userId]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Get Recent Photos Error:', error);
        res.status(500).json({ message: 'Error fetching recent photos' });
    }
};

// ─── Download ZIP ─────────────────────────────────────────────────────────────
//
// POST /api/photos/download-zip
// Body: { groupId, userId, filter }
//
// Builds a zip archive on-the-fly using the 'archiver' library and streams
// it back to the client — no temp file needed.

export const downloadZip = async (req: Request, res: Response): Promise<void> => {
    const { groupId, userId, filter = 'all' } = req.body as {
        groupId: number;
        userId: number;
        filter?: string;
    };

    if (!groupId) {
        res.status(400).json({ message: 'groupId is required' });
        return;
    }

    try {
        // Reuse the same filter logic as getGroupPhotos
        let query: string;
        let params: (string | number)[];

        switch (filter) {
            case 'mine':
                query = `
                    SELECT DISTINCT p.*
                    FROM photos p
                    JOIN tags t ON t.photo_id = p.id
                    WHERE p.group_id = $1 AND t.user_id = $2 AND t.tag_type = 'local'
                `;
                params = [groupId, userId];
                break;
            case 'group':
                query = `
                    SELECT DISTINCT p.*
                    FROM photos p
                    JOIN tags t1 ON t1.photo_id = p.id AND t1.user_id = $2
                    JOIN tags t2 ON t2.photo_id = p.id AND t2.user_id <> $2
                    WHERE p.group_id = $1
                `;
                params = [groupId, userId];
                break;
            case 'landscape':
                query = `SELECT * FROM photos WHERE group_id = $1 AND has_faces = FALSE`;
                params = [groupId];
                break;
            default:
                query = `SELECT * FROM photos WHERE group_id = $1`;
                params = [groupId];
        }

        const result = await db.query(query, params);
        const photos = result.rows;

        if (photos.length === 0) {
            res.status(404).json({ message: 'No photos match the selected filter' });
            return;
        }

        // Set headers for file download
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="faceo-photos-${Date.now()}.zip"`);

        const archive = archiver('zip', { zlib: { level: 6 } });
        archive.on('error', (err: Error) => {
            console.error('[downloadZip] Archiver error:', err);
            if (!res.headersSent) {
                res.status(500).json({ message: 'Error building zip' });
            }
        });

        archive.pipe(res);

        // Resolve disk paths from image_url (e.g. http://host/uploads/file.jpg → uploads/file.jpg)
        const uploadsDir = path.resolve(__dirname, '../../uploads');

        for (const photo of photos) {
            const filename = path.basename(photo.image_url);
            const diskPath = path.join(uploadsDir, filename);

            if (fs.existsSync(diskPath)) {
                archive.file(diskPath, { name: filename });
            } else {
                console.warn(`[downloadZip] File not found on disk: ${diskPath}`);
            }
        }

        await archive.finalize();
    } catch (error) {
        console.error('Download ZIP Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Error creating zip file' });
        }
    }
};

// ─── Get Photos By Face (Folder view) ─────────────────────────────────────────
//
// GET /api/photos/face/:userId?groupId=...
// Returns all photos from a group where the given user is tagged.

export const getPhotosByFace = async (req: Request, res: Response): Promise<void> => {
    const { taggedUserId } = req.params;
    const { groupId } = req.query as { groupId?: string };

    try {
        let query: string;
        let params: (string | number)[];

        if (groupId) {
            query = `
                SELECT DISTINCT p.*
                FROM photos p
                JOIN tags t ON t.photo_id = p.id
                WHERE p.group_id = $1
                  AND t.user_id  = $2
                ORDER BY p.uploaded_at DESC
            `;
            params = [groupId as string, taggedUserId as string];
        } else {
            query = `
                SELECT DISTINCT p.*
                FROM photos p
                JOIN tags t ON t.photo_id = p.id
                WHERE t.user_id = $1
                ORDER BY p.uploaded_at DESC
            `;
            params = [taggedUserId as string];
        }

        const result = await db.query(query, params);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Get Photos By Face Error:', error);
        res.status(500).json({ message: 'Error fetching photos by face' });
    }
};

// ─── Get Face Folders (Grid of faces for a group) ─────────────────────────────
//
// GET /api/photos/faces/:groupId
// Returns one row per distinct tagged identity (local or guest) with a
// thumbnail URL and photo count.

export const getFaceFolders = async (req: Request, res: Response): Promise<void> => {
    const { groupId } = req.params;

    try {
        // Local users tagged in this group
        const localRes = await db.query(
            `SELECT u.id AS user_id, u.username, u.profile_image AS thumbnail,
                    COUNT(DISTINCT t.photo_id) AS photo_count,
                    'local' AS tag_type,
                    NULL::text AS guest_code
             FROM tags t
             JOIN photos p  ON t.photo_id = p.id
             JOIN users u   ON t.user_id  = u.id
             WHERE p.group_id = $1
               AND t.tag_type = 'local'
             GROUP BY u.id, u.username, u.profile_image`,
            [groupId]
        );

        // Guest clusters in this group
        const guestRes = await db.query(
            `SELECT NULL AS user_id,
                    t.guest_code AS username,
                    p.image_url  AS thumbnail,
                    COUNT(DISTINCT t.photo_id) AS photo_count,
                    'guest' AS tag_type,
                    t.guest_code
             FROM tags t
             JOIN photos p ON t.photo_id = p.id
             WHERE p.group_id = $1
               AND t.tag_type = 'guest'
             GROUP BY t.guest_code, p.image_url`,
            [groupId]
        );

        const folders = [...localRes.rows, ...guestRes.rows];
        res.status(200).json(folders);
    } catch (error) {
        console.error('Get Face Folders Error:', error);
        res.status(500).json({ message: 'Error fetching face folders' });
    }
};