const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../auth');

// Configure Passport strategies
auth.configureLocalStrategy(
    async (username) => await db.users.getByUsername(username),
    async (password, hash) => await auth.verifyPassword(password, hash)
);

auth.configureJwtStrategy(
    async (id) => await db.users.getById(id)
);

// Configure Passport session serialization (required for OIDC)
auth.configureSessionSerialization(
    async (id) => await db.users.getById(id)
);

// Configure OIDC Strategy
auth.configureOidcStrategy(
    async (oidcId) => await db.users.getByOidcId(oidcId),
    async (email) => await db.users.getByEmail(email),
    async (userData) => await db.users.create(userData)
);

/**
 * Start OIDC Login
 * GET /api/auth/oidc/login
 */
router.get('/oidc/login', auth.passport.authenticate('openidconnect'));

/**
 * OIDC Callback
 * GET /api/auth/oidc/callback
 */
router.get('/oidc/callback',
    auth.passport.authenticate('openidconnect', { session: false, failureRedirect: '/login.html?error=SSO+Failed' }),
    (req, res) => {
        // Successful authentication
        const token = auth.generateToken(req.user);

        // Redirect to hompage with token
        res.redirect(`/?token=${token}`);
    }
);

/**
 * Check if initial setup is required
 * GET /api/auth/setup-required
 */
router.get('/setup-required', async (req, res) => {
    try {
        const userCount = await db.users.count();
        res.json({ setupRequired: userCount === 0 });
    } catch (err) {
        console.error('Error in /setup-required:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * Initial setup - Create admin user
 * POST /api/auth/setup
 */
router.post('/setup', async (req, res) => {
    return res.status(410).json({
        error: 'Local admin setup is disabled. Use Firebase authentication.'
    });
});

/**
 * Login with Passport Local Strategy
 * POST /api/auth/login
 */
router.post('/login', (req, res) => {
    return res.status(410).json({
        error: 'Username/password login is disabled. Use Firebase authentication.'
    });
});

/**
 * Login with Firebase ID token
 * POST /api/auth/firebase
 */
router.post('/firebase', async (req, res) => {
    try {
        const { idToken } = req.body;

        if (!idToken) {
            return res.status(400).json({ error: 'idToken is required' });
        }

        const firebaseIdentity = await auth.verifyFirebaseIdToken(idToken);

        if (!firebaseIdentity.email) {
            return res.status(400).json({ error: 'Firebase account must have an email address' });
        }

        if (!firebaseIdentity.emailVerified) {
            return res.status(403).json({ error: 'Email not verified. Please verify your email before continuing.' });
        }

        let user = await db.users.getByFirebaseUid(firebaseIdentity.uid);

        if (!user) {
            user = await db.users.getByEmail(firebaseIdentity.email);
        }

        if (!user) {
            const userCount = await db.users.count();
            const role = userCount === 0 ? 'admin' : 'viewer';
            const baseUsername = firebaseIdentity.email.split('@')[0] || 'user';
            let username = baseUsername;
            let suffix = 1;

            while (await db.users.getByUsername(username)) {
                username = `${baseUsername}${suffix++}`;
            }

            user = await db.users.create({
                username,
                role,
                email: firebaseIdentity.email,
                firebaseUid: firebaseIdentity.uid
            });
        } else if (!user.firebaseUid) {
            user = await db.users.update(user.id, { firebaseUid: firebaseIdentity.uid });
        }

        const token = auth.generateToken(user);

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                email: user.email,
                defaultLanguage: user.defaultLanguage || '',
                emailVerified: true
            }
        });
    } catch (err) {
        console.error('Firebase login error:', err);
        res.status(401).json({ error: err.message || 'Firebase authentication failed' });
    }
});

/**
 * Logout (client-side handles token removal)
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
    // With JWT, logout is handled client-side by removing the token
    // This endpoint exists for consistency and future server-side token blacklisting
    res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * Get current user
 * GET /api/auth/me
 */
router.get('/me', auth.requireAuth, async (req, res) => {
    try {
        const user = await db.users.getById(req.user.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            id: user.id,
            username: user.username,
            role: user.role,
            email: user.email || null,
            defaultLanguage: user.defaultLanguage || '',
            emailVerified: !!user.firebaseUid
        });
    } catch (err) {
        console.error('Error in /me:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * Update current user preferences
 * PATCH /api/auth/me/preferences
 */
router.patch('/me/preferences', auth.requireAuth, async (req, res) => {
    try {
        const { defaultLanguage } = req.body;

        const updates = {};
        if (defaultLanguage !== undefined) {
            updates.defaultLanguage = String(defaultLanguage || '').trim().toLowerCase().slice(0, 12);
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No valid preference updates provided' });
        }

        const user = await db.users.update(req.user.id, updates);

        res.json({
            id: user.id,
            username: user.username,
            role: user.role,
            email: user.email || null,
            defaultLanguage: user.defaultLanguage || '',
            emailVerified: !!user.firebaseUid
        });
    } catch (err) {
        console.error('Error updating preferences:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
});

/**
 * Change current user password
 * POST /api/auth/me/change-password
 */
router.post('/me/change-password', auth.requireAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        const user = await db.users.getById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Firebase users: verify current password, then update via Firebase.
        if (user.firebaseUid && user.email) {
            const session = await auth.verifyFirebasePassword(user.email, currentPassword);

            if (session.localId !== user.firebaseUid) {
                return res.status(403).json({ error: 'Account mismatch while updating password' });
            }

            await auth.updateFirebasePassword(session.idToken, newPassword);
            return res.json({ success: true, message: 'Password updated successfully' });
        }

        // Local users fallback.
        if (!user.passwordHash) {
            return res.status(400).json({ error: 'This account does not support local password changes' });
        }

        const isValid = await auth.verifyPassword(currentPassword, user.passwordHash);
        if (!isValid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const passwordHash = await auth.hashPassword(newPassword);
        await db.users.update(user.id, { passwordHash });

        return res.json({ success: true, message: 'Password updated successfully' });
    } catch (err) {
        console.error('Error changing password:', err);
        res.status(500).json({ error: err.message || 'Failed to change password' });
    }
});

/**
 * Get all users (admin only)
 * GET /api/auth/users
 */
router.get('/users', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    try {
        const allUsers = await db.users.getAll();

        // Remove password hashes
        const users = allUsers.map(u => {
            const { passwordHash, ...userWithoutPassword } = u;
            return userWithoutPassword;
        });

        res.json(users);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * Create a new user (admin only)
 * POST /api/auth/users
 */
router.post('/users', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    try {
        const { username, password, role } = req.body;

        if (!username || !password || !role) {
            return res.status(400).json({ error: 'Username, password, and role are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        if (!['admin', 'viewer'].includes(role)) {
            return res.status(400).json({ error: 'Role must be either "admin" or "viewer"' });
        }

        const passwordHash = await auth.hashPassword(password);
        const newUser = await db.users.create({
            username,
            passwordHash,
            role
        });

        res.status(201).json(newUser);
    } catch (err) {
        console.error('Error creating user:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
});

/**
 * Update a user (admin only)
 * PUT /api/auth/users/:id
 */
router.put('/users/:id', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { username, password, role } = req.body;

        const updates = {};

        if (username) {
            updates.username = username;
        }

        if (password) {
            if (password.length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters' });
            }
            updates.passwordHash = await auth.hashPassword(password);
        }

        if (role) {
            if (!['admin', 'viewer'].includes(role)) {
                return res.status(400).json({ error: 'Role must be either "admin" or "viewer"' });
            }

            // Prevent removing admin role from the last admin
            const user = await db.users.getById(id);
            if (user && user.role === 'admin' && role !== 'admin') {
                const allUsers = await db.users.getAll();
                const adminCount = allUsers.filter(u => u.role === 'admin').length;
                if (adminCount <= 1) {
                    return res.status(400).json({ error: 'Cannot remove admin role from the last admin user' });
                }
            }

            updates.role = role;
        }

        const updatedUser = await db.users.update(id, updates);
        res.json(updatedUser);
    } catch (err) {
        console.error('Error updating user:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
});

/**
 * Delete a user (admin only)
 * DELETE /api/auth/users/:id
 */
router.delete('/users/:id', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Prevent deleting yourself
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        await db.users.delete(id);
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (err) {
        console.error('Error deleting user:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
});

module.exports = router;
