import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const db = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'faceO_db', // Ensure this matches your DB name
    password: 'omri0106', // *** Insert your DB password here ***
    port: 5432,
});

export default db;