import { Request, Response } from 'express';
import db from '../config/db';

// Register a new user
export const register = async (req: Request, res: Response): Promise<void> => {
    // Extract only the fields that exist in our 'users' table schema
    const { username, email, password, phone_num, profile_image } = req.body;

    console.log("Starting registration for:", email);

    try {
        // 1. Check if the user already exists (by email)
        const checkUser = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        if (checkUser.rows.length > 0) {
            console.log("User already exists");
            res.status(400).json({ message: 'User already exists' });
            return;
        }

        // 2. Insert the new user into the database
        // Note: We use 'username', not 'first_name', matching the SQL schema
        const query = `
            INSERT INTO users (username, email, password, phone_num, profile_image)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, username, email, created_at
        `;

        // Prepare values (handle optional fields with null)
        const values = [username, email, password, phone_num || null, profile_image || null];

        const result = await db.query(query, values);

        console.log("User created successfully!");
        res.status(201).json({ success: true, user: result.rows[0] });

    } catch (error) {
        console.error("CRITICAL REGISTER ERROR:", error);
        res.status(500).json({ message: 'Server error during registration' });
    }
};

// Login user
export const login = async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    try {
        const query = 'SELECT * FROM users WHERE email = $1 AND password = $2';
        const result = await db.query(query, [email, password]);

        if (result.rows.length > 0) {
            const user = result.rows[0];
            delete user.password; // Do not send the password back to the client
            res.status(200).json({ success: true, user });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ message: 'Server error during login' });
    }
};