const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { db } = require('./firebase');
const admin = require('firebase-admin');
//demo comment
// Import routes
const profileRoutes = require('./routes/profile');
const paymentRoutes = require('./routes/payment');

// Load environment variables - make sure this is at the top
dotenv.config({ path: path.join(__dirname, '.env') });

// Check if required environment variables are set
if (!process.env.ZOHO_ORGANIZATION_ID) {
  console.warn('Warning: ZOHO_ORGANIZATION_ID not found in environment variables. Using hardcoded value.');
}

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  try {
    // Check if we have environment variables for Firebase credentials
    if (process.env.FIREBASE_PROJECT_ID && 
        process.env.FIREBASE_PRIVATE_KEY && 
        process.env.FIREBASE_CLIENT_EMAIL) {
      
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL
        })
      });
      console.log('Firebase Admin initialized using environment variables');
    } else {
      // Fall back to service account file
      const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
      if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        console.log('Firebase Admin initialized using service account file');
      } else {
        throw new Error('Firebase credentials not found');
      }
    }
  } catch (error) {
    console.error('Error initializing Firebase Admin:', error);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Token storage - environment-specific implementation
const tokenFilePath = path.join(__dirname, 'tokens.json');

// Initialize tokens
let tokens = { access_token: '', refresh_token: '', expires_at: 0 };

// Load tokens based on environment
const loadTokens = async () => {
  try {
    // For production (like Vercel), use Firestore
    if (process.env.NODE_ENV === 'production') {
      try {
        const tokenDoc = await db.collection('system').doc('zoho_tokens').get();
        
        if (tokenDoc.exists) {
          tokens = tokenDoc.data();
          console.log('Loaded tokens from Firestore');
        } else {
          // If no tokens in Firestore yet, try to initialize from environment variables
          if (process.env.ZOHO_ACCESS_TOKEN && process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_TOKEN_EXPIRES_AT) {
            tokens = {
              access_token: process.env.ZOHO_ACCESS_TOKEN,
              refresh_token: process.env.ZOHO_REFRESH_TOKEN,
              expires_at: parseInt(process.env.ZOHO_TOKEN_EXPIRES_AT)
            };
            
            // Save to Firestore
            await db.collection('system').doc('zoho_tokens').set(tokens);
            console.log('Initialized Firestore tokens from environment variables');
          } else {
            console.warn('No tokens found in Firestore or environment variables');
          }
        }
      } catch (firestoreError) {
        console.error('Firestore error, falling back to environment variables:', firestoreError);
        
        // Fall back to environment variables if Firestore fails
        if (process.env.ZOHO_ACCESS_TOKEN && process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_TOKEN_EXPIRES_AT) {
          tokens = {
            access_token: process.env.ZOHO_ACCESS_TOKEN,
            refresh_token: process.env.ZOHO_REFRESH_TOKEN,
            expires_at: parseInt(process.env.ZOHO_TOKEN_EXPIRES_AT)
          };
          console.log('Loaded tokens from environment variables');
        }
      }
    } 
    // For development, use file storage
    else {
      if (fs.existsSync(tokenFilePath)) {
        try {
          tokens = JSON.parse(fs.readFileSync(tokenFilePath, 'utf8'));
          console.log('Loaded tokens from file');
        } catch (error) {
          console.error('Error reading tokens file:', error);
        }
      } else {
        console.warn('Tokens file not found');
      }
    }
  } catch (error) {
    console.error('Error loading tokens:', error);
  }
};

// Save tokens - environment-specific implementation
const saveTokens = async () => {
  try {
    // For production (like Vercel), use Firestore
    if (process.env.NODE_ENV === 'production') {
      try {
        await db.collection('system').doc('zoho_tokens').set(tokens);
        console.log('Tokens saved to Firestore');
      } catch (firestoreError) {
        console.error('Error saving to Firestore, tokens will be lost on restart:', firestoreError);
        
        // Set environment variables for the current session (won't persist across restarts)
        process.env.ZOHO_ACCESS_TOKEN = tokens.access_token;
        process.env.ZOHO_REFRESH_TOKEN = tokens.refresh_token;
        process.env.ZOHO_TOKEN_EXPIRES_AT = tokens.expires_at.toString();
      }
    } 
    // For development, use file storage
    else {
      fs.writeFileSync(tokenFilePath, JSON.stringify(tokens, null, 2));
      console.log('Tokens saved to file');
    }
  } catch (error) {
    console.error('Error saving tokens:', error);
  }
};

// Load tokens on startup - make this async
(async () => {
  await loadTokens();
})();

// OAuth routes
app.get('/auth/zoho', (req, res) => {
  const authUrl = `https://accounts.zoho.com/oauth/v2/auth?scope=ZohoInventory.fullaccess.all&client_id=1000.E1FI8PQLI73ROCUKFFAPJO9O3ZPWNW&response_type=code&access_type=offline&redirect_uri=https://ecombackend-7z9j.vercel.app/auth/callback`;
  res.redirect(authUrl);
});

// Update the callback route to use async saveTokens
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  console.log(code)
  if (!code) {
    return res.status(400).send('Authorization code is missing');
  }

  try {
    const response = await axios.post('https://accounts.zoho.in/oauth/v2/token',null ,{
      params: {
        grant_type: 'authorization_code',
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        redirect_uri: 'https://ecombackend-7z9j.vercel.app/auth/callback',
        code : code
      }
    });
    console.log(response.data)
    tokens = {
      access_token: await response.data.access_token,
      refresh_token: await response.data.refresh_token || '',
      expires_at: Date.now() + (await response.data.expires_in * 1000)
    };
    console.log(tokens)
    await saveTokens(); // Make this await
    res.send('Authentication successful! You can now use the Zoho Inventory API.');
  } catch (error) {
    console.error('Error getting tokens:', error.response?.data || error.message);
    res.status(500).send(`${error.response?.data || error.message}`);
  }
});

// Update refreshAccessToken to use async saveTokens
const refreshAccessToken = async () => {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', process.env.ZOHO_CLIENT_ID);
    params.append('client_secret', process.env.ZOHO_CLIENT_SECRET);
    params.append('refresh_token', tokens.refresh_token);

    const response = await axios.post('https://accounts.zoho.in/oauth/v2/token', params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    tokens = {
      ...tokens,
      access_token: response.data.access_token,
      expires_at: Date.now() + (response.data.expires_in * 1000)
    };

    await saveTokens(); // Make this await
    return tokens.access_token;
  } catch (error) {
    console.error('Error refreshing token:', error.response?.data || error.message);
    throw new Error('Failed to refresh token');
  }
};

// Middleware to ensure valid token
const ensureValidToken = async (req, res, next) => {
  if (!tokens.access_token || !tokens.refresh_token) {
    return res.status(401).send('Not authenticated with Zoho. Please visit /auth/zoho to authenticate.');
  }

  // Check if token is expired or about to expire (within 5 minutes)
  if (Date.now() >= tokens.expires_at - 300000) {
    try {
      await refreshAccessToken();
    } catch (error) {
      return res.status(401).send('Authentication expired. Please visit /auth/zoho to re-authenticate.');
    }
  }

  next();
};

// API routes
app.get('/api/products', ensureValidToken, async (req, res) => {
  try {
    const response = await axios.get('https://www.zohoapis.in/inventory/v1/items', {
      headers: {
        'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
        'Content-Type': 'application/json',
        'organization_id': process.env.ZOHO_ORGANIZATION_ID
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching products:', error.response?.data || error.message);
    res.status(500).send('Failed to fetch products from Zoho Inventory');
  }
});

// Add new route to create a customer in Zoho Inventory
app.post('/api/customers', ensureValidToken, async (req, res) => {
  try {
    const customerData = {
      "contact_name": req.body.firstName +' '+req.body.lastName,
      "company_name": "ABC Company",
      "contact_type": "customer",
      "email": req.body.email,
      "phone": req.body.mobile
    }
    console.log(customerData)
    //Make request to Zoho Inventory API to create a contact (customer)
    const response = await axios.post(
      'https://www.zohoapis.in/inventory/v1/contacts', 
      customerData,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
          'Content-Type': 'application/json',
          'organization_id': ZOHO_ORGANIZATION_ID
        }
      }
    );

    console.log(response.data);
    
    // Store customer data in Firebase
    if (response.data && response.data.contact) {
      const zohoCustomer = response.data.contact;
      
      // Create a document in Firestore with Zoho customer ID
      await db.collection('customers').doc(zohoCustomer.contact_id.toString()).set({
        zohoContactId: zohoCustomer.contact_id,
        contactName: zohoCustomer.contact_name,
        email: zohoCustomer.email || req.body.email,
        phone: zohoCustomer.phone || req.body.mobile,
        createdAt: new Date(),
        zohoData: zohoCustomer // Store the complete Zoho response for reference
      });
      
      console.log('Customer data saved to Firebase');
    }

    res.status(201).json(response.data);
  } catch (error) {
    console.error('Error creating customer:', error.response?.data || error.message);
    res.status(500).send(`Failed to create customer in Zoho Inventory: ${error.response?.data?.message || error.message}`);
  }
});

// Add new route to create a sales order in Zoho Inventory
app.post('/api/salesorders', ensureValidToken, async (req, res) => {
  try {
    const salesOrderData = req.body;
    
    // Make request to Zoho Inventory API to create a sales order
    const response = await axios.post(
      'https://www.zohoapis.in/inventory/v1/salesorders', 
      salesOrderData,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
          'Content-Type': 'application/json',
          'organization_id': 60038401466
        }
      }
    );

    res.status(201).json(response.data);
  } catch (error) {
    console.error('Error creating sales order:', error.response?.data || error.message);
    res.status(500).send(`Failed to create sales order in Zoho Inventory: ${error.response?.data?.message || error.message}`);
  }
});

// Add Firebase Auth verification middleware

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

// Replace your existing profile endpoint with this one


app.use('/api', profileRoutes);
app.use('/api', paymentRoutes);
// Home route
app.get('/', (req, res) => {
  res.send(`
    <h1>Zoho Inventory API Server</h1>
    <p>Available endpoints:</p>
    <ul>
      <li><a href="/auth/zoho">Authenticate with Zoho</a></li>
      <li><a href="/api/products">Get Products</a> (requires authentication)</li>
    </ul>
  `);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});