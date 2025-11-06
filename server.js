const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { db } = require('./firebase');
const admin = require('firebase-admin');

// Import routes
const profileRoutes = require('./routes/profile');
const paymentRoutes = require('./routes/payment');
const productRoutes = require('./routes/products');
const adminRoutes = require('./routes/admin');
const packageRoutes = require('./routes/packages');
const shipmentRoutes = require('./routes/shipments');
const cartRoutes = require('./routes/cart');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Create customer route
app.post('/api/customers', async (req, res) => {
  try {
    const { firstName, lastName, email, mobile } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email) {
      return res.status(400).json({ error: 'First name, last name, and email are required' });
    }

    // Check if customer already exists by email
    const existingCustomerSnapshot = await db.collection('customers')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (!existingCustomerSnapshot.empty) {
      const existingCustomer = existingCustomerSnapshot.docs[0];
      return res.status(409).json({
        error: 'Customer already exists',
        customerId: existingCustomer.id,
        customer: {
          id: existingCustomer.id,
          ...existingCustomer.data()
        }
      });
    }

    // Create customer data
    const contactName = `${firstName} ${lastName}`;
    const customerData = {
      contactName: contactName,
      firstName: firstName,
      lastName: lastName,
      email: email,
      phone: mobile || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Add userId if provided in request body
    if (req.body.userId) {
      customerData.userId = req.body.userId;
    }

    // Create customer document in Firestore
    const customerRef = await db.collection('customers').add(customerData);

    // Update user document if userId is provided
    if (req.body.userId) {
      try {
        const userRef = db.collection('users').doc(req.body.userId);
        await userRef.set({
          email: email,
          displayName: contactName,
          phoneNumber: mobile || '',
          customerId: customerRef.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (userError) {
        console.error('Error updating user document:', userError);
        // Continue even if user update fails
      }
    }

    console.log('Customer data saved to Firebase');

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      customer: {
        id: customerRef.id,
        ...customerData
      }
    });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({
      error: 'Failed to create customer',
      message: error.message
    });
  }
});

// Routes
app.use('/api', profileRoutes);
app.use('/api', paymentRoutes);
app.use('/api', productRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/cart', cartRoutes);

// Home route
app.get('/', (req, res) => {
  res.send(`
    <h1>Ecommerce Backend API</h1>
    <p>Available endpoints:</p>
    <ul>
      <li><a href="/api/products">Get Products</a></li>
      <li><a href="/api/cart">Cart Management</a></li>
      <li><a href="/api/orders">Orders</a></li>
      <li><a href="/api/admin">Admin Routes</a></li>
    </ul>
  `);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
