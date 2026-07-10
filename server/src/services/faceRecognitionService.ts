/**
 * faceRecognitionService.ts
 *
 * Handles all facial-recognition logic:
 *  1. In-memory embedding cache (avoids repeated Python calls for the same user).
 *  2. cosine-distance matching against group members.
 *  3. Tagging photos as 'local' (group member) or 'guest' (anonymous).
 *  4. Guest-to-local promotion when a new user joins a group.
 *
 * The heavy lifting (DeepFace / ArcFace) runs in a sidecar Python script
 * (faceO_api.py).  We spawn it with child_process and exchange JSON over
 * stdin / stdout so Node never imports native C++ bindings directly.
 */

import { spawn } from 'child_process';
import path from 'path';
import db from '../config/db';
import type { FaceRecognitionResult, Tag } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────
const COSINE_THRESHOLD = 0.55;          // matches faceO_api.py
const PYTHON_SCRIPT    = path.resolve(__dirname, '../../faceO_api_worker.py');

// ─── In-process embedding cache ───────────────────────────────────────────────
// Key: user_id  Value: { embedding, cachedAt }
const embeddingCache = new Map<number, { embedding: number[]; cachedAt: number }>();
const CACHE_TTL_MS   = 60 * 60 * 1000;   // 1 hour

/** Cosine distance between two unit-normalised vectors. */
function cosineDistance(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─── Python worker ────────────────────────────────────────────────────────────

/**
 * Calls the Python worker script to extract face embeddings from a local image
 * file.  Returns an array of FaceRecognitionResult (one per detected face).
 */
export async function extractEmbeddings(imagePath: string): Promise<FaceRecognitionResult[]> {
    return new Promise((resolve, reject) => {
        const py = spawn('python3', [PYTHON_SCRIPT, '--mode', 'extract', '--image', imagePath]);

        let output = '';
        let errOutput = '';

        py.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
        py.stderr.on('data', (chunk: Buffer) => { errOutput += chunk.toString(); });

        py.on('close', (code) => {
            if (code !== 0) {
                console.error('[FaceService] Python worker error:', errOutput);
                // If Python fails (e.g. no faces), return empty list instead of crashing
                resolve([]);
                return;
            }
            try {
                const parsed: FaceRecognitionResult[] = JSON.parse(output);
                resolve(parsed);
            } catch {
                console.error('[FaceService] JSON parse error:', output);
                resolve([]);
            }
        });
    });
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

/**
 * Returns the face embedding for a user, checking the in-memory cache first,
 * then the face_cache DB table, then re-computing from profile image.
 */
async function getEmbeddingForUser(userId: number): Promise<number[] | null> {
    // 1. In-memory cache
    const cached = embeddingCache.get(userId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        return cached.embedding;
    }

    // 2. DB cache
    const dbCache = await db.query<{ embedding: number[] }>(
        'SELECT embedding FROM face_cache WHERE user_id = $1',
        [userId]
    );
    if (dbCache.rows.length > 0) {
        const emb = dbCache.rows[0].embedding;
        embeddingCache.set(userId, { embedding: emb, cachedAt: Date.now() });
        return emb;
    }

    // 3. Compute from profile image stored in users table
    const userRow = await db.query<{ profile_image: string | null }>(
        'SELECT profile_image FROM users WHERE id = $1',
        [userId]
    );
    if (!userRow.rows[0]?.profile_image) return null;

    // The profile image is stored as a server path or URL.
    // For local paths we can pass directly to Python.
    const profilePath = userRow.rows[0].profile_image;
    // If URL, Python worker handles download; otherwise treat as disk path.
    const results = await extractEmbeddings(profilePath);
    if (results.length === 0) return null;

    const emb = results[0].embedding;

    // Persist to DB cache
    await db.query(
        `INSERT INTO face_cache (user_id, embedding, cached_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET embedding = $2, cached_at = NOW()`,
        [userId, emb]
    );
    embeddingCache.set(userId, { embedding: emb, cachedAt: Date.now() });
    return emb;
}

/** Invalidate cache for a user (call when profile image changes). */
export async function invalidateUserCache(userId: number): Promise<void> {
    embeddingCache.delete(userId);
    await db.query('DELETE FROM face_cache WHERE user_id = $1', [userId]);
}

// ─── Core recognition pipeline ────────────────────────────────────────────────

/**
 * Processes a newly uploaded photo:
 *  1. Extracts embeddings from every face in the image.
 *  2. For each face:
 *     a. Compares against all group members (using cache).
 *     b. Tags as 'local' if distance < threshold, otherwise 'guest'.
 *  3. Marks photo.has_faces = true if at least one face was found.
 */
export async function recogniseAndTagPhoto(
    photoId: number,
    imagePath: string,
    groupId: number
): Promise<void> {
    console.log(`[FaceService] Processing photo ${photoId} (group ${groupId})`);

    // 1. Extract faces
    const faces = await extractEmbeddings(imagePath);
    if (faces.length === 0) {
        console.log(`[FaceService] No faces detected in photo ${photoId}`);
        return;
    }

    // Mark photo as having faces
    await db.query('UPDATE photos SET has_faces = TRUE WHERE id = $1', [photoId]);

    // 2. Get group members
    const membersRes = await db.query<{ user_id: number }>(
        'SELECT user_id FROM group_members WHERE group_id = $1',
        [groupId]
    );
    const memberIds = membersRes.rows.map(r => r.user_id);

    // 3. Build member embedding map (with cache)
    const memberEmbeddings: Map<number, number[]> = new Map();
    for (const uid of memberIds) {
        const emb = await getEmbeddingForUser(uid);
        if (emb) memberEmbeddings.set(uid, emb);
    }

    // 4. Tag each face
    // Track cluster labels for guest faces in this photo
    const guestClusterCounter: Map<string, number> = new Map();
    let guestIndex = 0;

    for (const face of faces) {
        let bestUserId: number | null = null;
        let bestDist = Infinity;

        for (const [uid, emb] of memberEmbeddings) {
            const dist = cosineDistance(face.embedding, emb);
            if (dist < bestDist) {
                bestDist = dist;
                bestUserId = uid;
            }
        }

        if (bestUserId !== null && bestDist < COSINE_THRESHOLD) {
            // ── LOCAL TAG ──
            await db.query(
                `INSERT INTO tags (photo_id, user_id, tag_type, face_embedding, tagged_at)
                 VALUES ($1, $2, 'local', $3, NOW())
                 ON CONFLICT (photo_id, user_id) DO NOTHING`,
                [photoId, bestUserId, face.embedding]
            ).catch(err => console.error('[FaceService] Insert local tag error:', err));
        } else {
            // ── GUEST TAG ──
            const guestLabel = `Anonymous_${guestIndex++}`;
            await db.query(
                `INSERT INTO tags (photo_id, user_id, tag_type, guest_code, face_embedding, tagged_at)
                 VALUES ($1, NULL, 'guest', $2, $3, NOW())
                 ON CONFLICT (photo_id, guest_code) DO NOTHING`,
                [photoId, guestLabel, face.embedding]
            ).catch(err => console.error('[FaceService] Insert guest tag error:', err));
        }
    }

    console.log(`[FaceService] Tagged ${faces.length} face(s) in photo ${photoId}`);
}

// ─── Guest → Local promotion ──────────────────────────────────────────────────

/**
 * Called when a new user joins a group.
 *
 * Scans all guest tags across the group's photos and re-checks whether
 * their stored embeddings match the new member.  If they do, the tag is
 * converted from 'guest' to 'local'.
 */
export async function promoteGuestTagsForNewMember(
    userId: number,
    groupId: number
): Promise<void> {
    console.log(`[FaceService] Promoting guest tags for user ${userId} in group ${groupId}`);

    // 1. Get new member's embedding
    const newMemberEmbedding = await getEmbeddingForUser(userId);
    if (!newMemberEmbedding) {
        console.warn(`[FaceService] No embedding for user ${userId}, skipping promotion`);
        return;
    }

    // 2. Fetch all guest tags in this group that still have a stored embedding
    const guestTagsRes = await db.query<Tag & { face_embedding: number[] }>(
        `SELECT t.id, t.photo_id, t.guest_code, t.face_embedding
         FROM tags t
         JOIN photos p ON t.photo_id = p.id
         WHERE p.group_id = $1
           AND t.tag_type  = 'guest'
           AND t.face_embedding IS NOT NULL`,
        [groupId]
    );

    let promoted = 0;
    for (const guestTag of guestTagsRes.rows) {
        const dist = cosineDistance(guestTag.face_embedding, newMemberEmbedding);
        if (dist < COSINE_THRESHOLD) {
            // Convert to local tag
            await db.query(
                `UPDATE tags
                 SET user_id   = $1,
                     tag_type  = 'local',
                     guest_code = NULL,
                     tagged_at  = NOW()
                 WHERE id = $2`,
                [userId, guestTag.id]
            );
            promoted++;
        }
    }

    console.log(`[FaceService] Promoted ${promoted} guest tag(s) for user ${userId}`);
}
