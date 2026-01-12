import { Request, Response } from 'express';
import db from '../config/db';

// Create a new group
export const createGroup = async (req: Request, res: Response): Promise<void> => {
    const { name, description, userId } = req.body;
    try {
        const result = await db.query(
            'INSERT INTO groups (name, description, created_by) VALUES ($1, $2, $3) RETURNING *',
            [name, description, userId]
        );
        const newGroup = result.rows[0];
        await db.query('INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)', [newGroup.id, userId]);
        res.status(201).json({ success: true, group: newGroup });
    } catch (error) {
        console.error("Create Group Error:", error);
        res.status(500).json({ message: 'Error creating group' });
    }
};

// Get groups for a specific user
export const getUserGroups = async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params;
    try {
        const query = `
            SELECT DISTINCT g.*
            FROM groups g
            LEFT JOIN group_members gm ON g.id = gm.group_id
            WHERE g.created_by = $1 OR gm.user_id = $1
            ORDER BY g.created_at DESC
        `;
        const result = await db.query(query, [userId]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Get User Groups Error:", error);
        res.status(500).json({ message: 'Error fetching user groups' });
    }
};

// Get single group details
export const getGroupDetails = async (req: Request, res: Response): Promise<void> => {
    const { groupId } = req.params;
    try {
        const result = await db.query('SELECT * FROM groups WHERE id = $1', [groupId]);
        if (result.rows.length === 0) {
            res.status(404).json({ message: 'Group not found' });
            return;
        }
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error("Get Group Details Error:", error);
        res.status(500).json({ message: 'Error fetching group details' });
    }
};

// --- הוספת תמונה (מעודכן לטיפול בקבצים) ---
export const addPhoto = async (req: Request, res: Response): Promise<void> => {
    // כאשר משתמשים ב-multer, המידע הטקסטואלי נמצא ב-req.body
    // והקובץ נמצא ב-req.file
    const { groupId, userId } = req.body;
    const file = req.file;

    if (!file) {
        res.status(400).json({ message: 'No file uploaded' });
        return;
    }

    // יצירת ה-URL המלא לתמונה בשרת
    // לדוגמה: http://localhost:8080/uploads/123456-image.jpg
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${file.filename}`;

    try {
        const query = `
            INSERT INTO photos (group_id, uploaded_by, image_url, taken_at)
            VALUES ($1, $2, $3, NOW())
            RETURNING *
        `;
        const result = await db.query(query, [groupId, userId, imageUrl]);
        res.status(201).json({ success: true, photo: result.rows[0] });
    } catch (error) {
        console.error("Add Photo Error:", error);
        res.status(500).json({ message: 'Error adding photo' });
    }
};

// Fetch photos by group ID
export const getGroupPhotos = async (req: Request, res: Response): Promise<void> => {
    const { groupId } = req.params;
    try {
        const result = await db.query(
            'SELECT * FROM photos WHERE group_id = $1 ORDER BY uploaded_at DESC',
            [groupId]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Get Photos Error:", error);
        res.status(500).json({ message: 'Error fetching photos' });
    }
};

// קבלת תמונות אחרונות לדשבורד
export const getRecentPhotos = async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params;
    try {
        // שליפת תמונות מכל הקבוצות שהמשתמש חבר בהן
        const query = `
            SELECT DISTINCT p.*
            FROM photos p
            JOIN group_members gm ON p.group_id = gm.group_id
            WHERE gm.user_id = $1
            ORDER BY p.uploaded_at DESC
            LIMIT 12
        `;
        const result = await db.query(query, [userId]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Get Recent Photos Error:", error);
        res.status(500).json({ message: 'Error fetching recent photos' });
    }
};