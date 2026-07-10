/**
 * api.ts — Full API Router
 *
 * Combines the original routes with all new endpoints required by the PRD.
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { register, login } from '../controllers/authController';
import {
    createGroup,
    getUserGroups,
    getGroupDetails,
    getGroupMembers,
    joinGroupByToken,
    getInviteLink,
    leaveGroup,
} from '../controllers/groupController';
import {
    addPhoto,
    getGroupPhotos,
    getRecentPhotos,
    downloadZip,
    getPhotosByFace,
    getFaceFolders,
} from '../controllers/photoController';

const router = Router();

// ─── Multer — file storage ────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, 'uploads/');   // must exist or be created at server start
    },
    filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, unique + path.extname(file.originalname));
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },  // 20 MB per file
    fileFilter: (_req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp/;
        const ok = allowed.test(path.extname(file.originalname).toLowerCase())
                && allowed.test(file.mimetype);
        ok ? cb(null, true) : cb(new Error('Only image files are allowed'));
    },
});

// ─── Auth ─────────────────────────────────────────────────────────────────────
router.post('/auth/sign-up', register);
router.post('/auth/sign-in', login);

// ─── Groups ───────────────────────────────────────────────────────────────────
router.post  ('/groups/create',               createGroup);
router.get   ('/groups/user/:userId',         getUserGroups);
router.get   ('/groups/:groupId',             getGroupDetails);
router.get   ('/groups/:groupId/members',     getGroupMembers);
router.get   ('/groups/:groupId/invite',      getInviteLink);
router.post  ('/groups/:groupId/leave',       leaveGroup);

// Join via invite token (user clicks a share link in the browser)
router.post  ('/join/:token',                 joinGroupByToken);

// ─── Photos ───────────────────────────────────────────────────────────────────

// Upload — multer handles multipart; face recognition runs async after response
router.post  ('/photos/add',                  upload.single('photo'), addPhoto);

// Filtered list — ?filter=mine|group|landscape|all  &userId=<id>
router.get   ('/photos/group/:groupId',       getGroupPhotos);

// Dashboard recent photos
router.get   ('/photos/recent/:userId',       getRecentPhotos);

// Server-side zip download
// POST body: { groupId, userId, filter }
router.post  ('/photos/download-zip',         downloadZip);

// Folder view: all photos in which a specific user appears
router.get   ('/photos/by-face/:taggedUserId', getPhotosByFace);

// Face-folder summary for EventScreen grid
router.get   ('/photos/faces/:groupId',       getFaceFolders);

export default router;
