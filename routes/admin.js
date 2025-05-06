const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const admin = require('firebase-admin');

// Firebase Auth verification middleware
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }
  
  const token = authHeader.split('Bearer ')[1];
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Verify admin middleware
const verifyAdmin = async (req, res, next) => {
  if (!req.user || !req.user.admin) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
};

// Admin user creation form
router.get('/create-form', async (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Admin User</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  </head>
  <body>
    <div class="container mt-5">
      <div class="row justify-content-center">
        <div class="col-md-8">
          <div class="card">
            <div class="card-header bg-primary text-white">
              <h3 class="mb-0">Create Admin User</h3>
            </div>
            <div class="card-body">
              <form id="adminForm">
                <div class="mb-3">
                  <label for="masterPassword" class="form-label">Master Password</label>
                  <input type="password" class="form-control" id="masterPassword" required>
                  <div class="form-text">Enter the master password to authorize admin creation</div>
                </div>
                
                <div class="mb-3">
                  <label for="email" class="form-label">Email</label>
                  <input type="email" class="form-control" id="email" required>
                </div>
                
                <div class="mb-3">
                  <label for="password" class="form-label">Password</label>
                  <input type="password" class="form-control" id="password" required>
                  <div class="form-text">Password must be at least 6 characters</div>
                </div>
                
                <div class="mb-3">
                  <label for="displayName" class="form-label">Display Name</label>
                  <input type="text" class="form-control" id="displayName" required>
                </div>
                
                <div class="mb-3">
                  <label for="phoneNumber" class="form-label">Phone Number</label>
                  <input type="tel" class="form-control" id="phoneNumber">
                  <div class="form-text">Format: +91XXXXXXXXXX</div>
                </div>
                
                <div class="mb-3 form-check">
                  <input type="checkbox" class="form-check-input" id="superAdmin">
                  <label class="form-check-label" for="superAdmin">Super Admin</label>
                  <div class="form-text">Super admins have access to all features</div>
                </div>
                
                <div class="mb-3">
                  <label class="form-label">Permissions</label>
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="manageProducts">
                    <label class="form-check-label" for="manageProducts">Manage Products</label>
                  </div>
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="manageOrders">
                    <label class="form-check-label" for="manageOrders">Manage Orders</label>
                  </div>
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="manageUsers">
                    <label class="form-check-label" for="manageUsers">Manage Users</label>
                  </div>
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="manageSettings">
                    <label class="form-check-label" for="manageSettings">Manage Settings</label>
                  </div>
                </div>
                
                <button type="submit" class="btn btn-primary">Create Admin</button>
              </form>
              
              <div class="mt-3" id="statusMessage"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <script>
      document.getElementById('adminForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const statusMsg = document.getElementById('statusMessage');
        statusMsg.innerHTML = '<div class="alert alert-info">Creating admin user...</div>';
        
        const masterPassword = document.getElementById('masterPassword').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const displayName = document.getElementById('displayName').value;
        const phoneNumber = document.getElementById('phoneNumber').value;
        const superAdmin = document.getElementById('superAdmin').checked;
        
        // Collect permissions
        const permissions = {
          manageProducts: document.getElementById('manageProducts').checked,
          manageOrders: document.getElementById('manageOrders').checked,
          manageUsers: document.getElementById('manageUsers').checked,
          manageSettings: document.getElementById('manageSettings').checked
        };
        
        try {
          const response = await fetch('/api/admin/create', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              masterPassword,
              email,
              password,
              displayName,
              phoneNumber,
              superAdmin,
              permissions
            })
          });
          
          const result = await response.json();
          
          if (response.ok) {
            statusMsg.innerHTML = '<div class="alert alert-success">Admin user created successfully!</div>';
            document.getElementById('adminForm').reset();
          } else {
            throw new Error(result.error || 'Failed to create admin user');
          }
        } catch (error) {
          statusMsg.innerHTML = '<div class="alert alert-danger">Error: ' + error.message + '</div>';
        }
      });
    </script>
  </body>
  </html>
  `;
  
  res.send(html);
});

// Create admin user API endpoint
router.post('/create', async (req, res) => {
  try {
    const { 
      masterPassword, 
      email, 
      password, 
      displayName, 
      phoneNumber, 
      superAdmin, 
      permissions 
    } = req.body;
    
    // Verify master password (store this securely in environment variables in production)
    const correctMasterPassword = process.env.ADMIN_MASTER_PASSWORD || 'admin123!@#';
    
    if (masterPassword !== correctMasterPassword) {
      return res.status(401).json({ error: 'Invalid master password' });
    }
    
    // Validate email and password
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ 
        error: 'Invalid input. Email is required and password must be at least 6 characters.' 
      });
    }
    
    // Create user in Firebase Authentication
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: displayName || undefined,
      phoneNumber: phoneNumber || undefined,
      emailVerified: true // Auto-verify admin emails
    });
    
    // Set custom claims for admin privileges
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      admin: true,
      superAdmin: superAdmin || false,
      permissions: permissions || {}
    });
    
    // Store additional admin data in Firestore
    await db.collection('users').doc(userRecord.uid).set({
      email: email,
      displayName: displayName || '',
      phoneNumber: phoneNumber || '',
      isAdmin: true,
      isSuperAdmin: superAdmin || false,
      permissions: permissions || {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLogin: null
    });
    
    // Log admin creation
    await db.collection('admin_logs').add({
      action: 'create_admin',
      targetUser: userRecord.uid,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      details: {
        email: email,
        displayName: displayName,
        superAdmin: superAdmin,
        permissions: permissions
      }
    });
    
    res.status(201).json({ 
      success: true, 
      message: 'Admin user created successfully',
      uid: userRecord.uid
    });
  } catch (error) {
    console.error('Error creating admin user:', error);
    res.status(500).json({ 
      error: 'Failed to create admin user', 
      message: error.message 
    });
  }
});

// Get all admin users
router.get('/list', verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const usersSnapshot = await db.collection('users')
      .where('isAdmin', '==', true)
      .get();
    
    const admins = [];
    usersSnapshot.forEach(doc => {
      admins.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({ admins });
  } catch (error) {
    console.error('Error fetching admin users:', error);
    res.status(500).json({ error: 'Failed to fetch admin users' });
  }
});

module.exports = router;