import { Router } from 'express';
import multer from 'multer'; // <--- הוסף
import path from 'path'; // <--- הוסף
import { register, login } from '../controllers/authController';
import { createGroup, getUserGroups, addPhoto, getGroupPhotos, getGroupDetails, getRecentPhotos } from '../controllers/dataController';

const router = Router();

// --- הגדרת Multer לאחסון קבצים ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // התיקייה בה יישמרו הקבצים
    },
    filename: (req, file, cb) => {
        // יצירת שם ייחודי לקובץ: timestamp + סיומת מקורית
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });
// ------------------------------------


// Auth Routes
router.post('/auth/sign-up', register);
router.post('/auth/sign-in', login);

// Group Routes
router.post('/groups/create', createGroup);
router.get('/groups/user/:userId', getUserGroups);
router.get('/groups/:groupId', getGroupDetails); // <--- נתיב חדש לדף קבוצה

// Photo Routes
// שינוי חשוב: הוספנו את upload.single('photo')
// זה אומר לשרת לצפות לקובץ בשדה שנקרא 'photo'
router.post('/photos/add', upload.single('photo'), addPhoto);
router.get('/photos/group/:groupId', getGroupPhotos);
router.get('/photos/recent/:userId', getRecentPhotos); // <--- נתיב חדש לדשבורד

export default router;