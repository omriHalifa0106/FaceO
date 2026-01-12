import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path'; // <--- הוסף
import apiRoutes from './routes/api';

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// הוסף את השורה הזו: אפשר גישה ציבורית לתיקיית התמונות
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api', apiRoutes);

app.get('/', (req, res) => {
    res.send('FaceO Server is Running with DB Connection! 🚀');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});