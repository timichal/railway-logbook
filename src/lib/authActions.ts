'use server';

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { query } from './db';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key-change-in-production');
const COOKIE_NAME = 'railway-auth';

export interface User {
  id: number;
  email: string;
  name?: string;
}

export async function createToken(user: User): Promise<string> {
  return new SignJWT({ userId: user.id, email: user.email, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<User | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      id: payload.userId as number,
      email: payload.email as string,
      name: payload.name as string,
    };
  } catch {
    return null;
  }
}

export async function getUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  
  if (!token) {
    return null;
  }
  
  return verifyToken(token);
}

export async function login(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  // Get user from database
  const result = await query(
    'SELECT id, email, name, password FROM users WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    throw new Error('Invalid email or password');
  }

  const user = result.rows[0];
  
  // Check password
  const isValid = await bcrypt.compare(password, user.password || '');
  
  if (!isValid) {
    throw new Error('Invalid email or password');
  }

  // Create JWT token
  const token = await createToken({ id: user.id, email: user.email, name: user.name });
  
  // Set cookie
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return { success: true, user: { id: user.id, email: user.email, name: user.name } };
}

export async function register(
  formData: FormData,
  localTrips?: { track_id: string; date: string; note: string | null; partial: boolean }[],
  localPreferences?: string[]
) {
  const name = formData.get('name') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;

  if (!email || !password || !confirmPassword) {
    throw new Error('All fields are required');
  }

  if (password !== confirmPassword) {
    throw new Error('Passwords do not match');
  }

  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  // Check if user already exists
  const existingUser = await query(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );

  if (existingUser.rows.length > 0) {
    throw new Error('User with this email already exists');
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 12);

  // Insert user
  const result = await query(
    'INSERT INTO users (email, name, password) VALUES ($1, $2, $3) RETURNING id, email, name',
    [email, name || null, hashedPassword]
  );

  const user = result.rows[0];

  let migratedCount = 0;
  let skippedCount = 0;

  // Migrate localStorage trips if provided
  if (localTrips && localTrips.length > 0) {
    for (const trip of localTrips) {
      try {
        // Check for exact duplicate (same track_id, date, note, partial)
        const duplicateCheck = await query(
          `SELECT id FROM user_trips
           WHERE user_id = $1
           AND track_id = $2
           AND date = $3
           AND (note = $4 OR (note IS NULL AND $4 IS NULL))
           AND partial = $5`,
          [user.id, parseInt(trip.track_id), trip.date, trip.note, trip.partial]
        );

        if (duplicateCheck.rows.length === 0) {
          // Not a duplicate, insert it
          await query(
            'INSERT INTO user_trips (user_id, track_id, date, note, partial) VALUES ($1, $2, $3, $4, $5)',
            [user.id, parseInt(trip.track_id), trip.date, trip.note, trip.partial]
          );
          migratedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        console.error('Error migrating trip:', error);
        // Continue with other trips even if one fails
      }
    }
  }

  // Migrate localStorage preferences if provided
  if (localPreferences && localPreferences.length > 0) {
    try {
      await query(
        'INSERT INTO user_preferences (user_id, selected_countries) VALUES ($1, $2)',
        [user.id, localPreferences]
      );
    } catch (error) {
      console.error('Error migrating preferences:', error);
      // Non-fatal, continue
    }
  }

  // Create JWT token
  const token = await createToken({ id: user.id, email: user.email, name: user.name });

  // Set cookie
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return {
    success: true,
    user: { id: user.id, email: user.email, name: user.name },
    migrated: migratedCount,
    skipped: skippedCount
  };
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  redirect('/');
}