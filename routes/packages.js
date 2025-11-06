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

// Create a new package
router.post('/create', verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const {
      orderId,
      packageName,
      packageNumber,
      length,
      width,
      height,
      weight,
      items
    } = req.body;

    // Validate required fields
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Package items are required' });
    }

    // Verify order exists
    const orderSnapshot = await db.collection('orders')
      .where('orderId', '==', orderId)
      .limit(1)
      .get();

    if (orderSnapshot.empty) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Generate package number if not provided
    const generatedPackageNumber = packageNumber || `PKG-${Date.now()}`;

    // Store package data in Firestore
    const packageRef = await db.collection('packages').add({
      orderId: orderId,
      packageName: packageName || `Package for ${orderId}`,
      packageNumber: generatedPackageNumber,
      dimensions: {
        length: length || 10,
        width: width || 10,
        height: height || 10,
        unit: "cm"
      },
      weight: {
        weight: weight || 500,
        unit: "g"
      },
      items: items,
      status: 'created',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.uid
    });

    res.status(201).json({
      success: true,
      message: 'Package created successfully',
      packageId: packageRef.id,
      package: {
        id: packageRef.id,
        orderId: orderId,
        packageName: packageName || `Package for ${orderId}`,
        packageNumber: generatedPackageNumber
      }
    });
  } catch (error) {
    console.error('Error creating package:', error);
    res.status(500).json({
      error: 'Failed to create package',
      message: error.message
    });
  }
});

// Get all packages
router.get('/', verifyFirebaseToken, async (req, res) => {
  try {
    const { page = 1, limit = 25, orderId } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    let query = db.collection('packages').orderBy('createdAt', 'desc');

    if (orderId) {
      query = query.where('orderId', '==', orderId);
    }

    const snapshot = await query
      .limit(limitNum)
      .offset((pageNum - 1) * limitNum)
      .get();

    const packages = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      packages.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || null
      });
    });

    res.json({
      packages: packages,
      page: pageNum,
      limit: limitNum,
      total: packages.length
    });
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.status(500).json({
      error: 'Failed to fetch packages',
      message: error.message
    });
  }
});

// Get package by ID
router.get('/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;

    const packageDoc = await db.collection('packages').doc(id).get();

    if (!packageDoc.exists) {
      return res.status(404).json({ error: 'Package not found' });
    }

    const packageData = packageDoc.data();
    res.json({
      id: packageDoc.id,
      ...packageData,
      createdAt: packageData.createdAt?.toDate?.() || null
    });
  } catch (error) {
    console.error('Error fetching package:', error);
    res.status(500).json({
      error: 'Failed to fetch package',
      message: error.message
    });
  }
});

// Update package
router.put('/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      packageName,
      length,
      width,
      height,
      weight,
      items,
      status
    } = req.body;

    const packageRef = db.collection('packages').doc(id);
    const packageDoc = await packageRef.get();

    if (!packageDoc.exists) {
      return res.status(404).json({ error: 'Package not found' });
    }

    const updateFields = {};

    if (packageName) updateFields.packageName = packageName;

    if (length || width || height) {
      const currentData = packageDoc.data();
      updateFields.dimensions = {
        length: length || currentData.dimensions?.length || 10,
        width: width || currentData.dimensions?.width || 10,
        height: height || currentData.dimensions?.height || 10,
        unit: "cm"
      };
    }

    if (weight !== undefined) {
      updateFields.weight = {
        weight: weight,
        unit: "g"
      };
    }

    if (items && Array.isArray(items) && items.length > 0) {
      updateFields.items = items;
    }

    if (status) {
      updateFields.status = status;
    }

    updateFields.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await packageRef.update(updateFields);

    const updatedDoc = await packageRef.get();

    res.json({
      success: true,
      message: 'Package updated successfully',
      package: {
        id: updatedDoc.id,
        ...updatedDoc.data()
      }
    });
  } catch (error) {
    console.error('Error updating package:', error);
    res.status(500).json({
      error: 'Failed to update package',
      message: error.message
    });
  }
});

// Delete package
router.delete('/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const packageRef = db.collection('packages').doc(id);
    const packageDoc = await packageRef.get();

    if (!packageDoc.exists) {
      return res.status(404).json({ error: 'Package not found' });
    }

    await packageRef.delete();

    res.json({
      success: true,
      message: 'Package deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting package:', error);
    res.status(500).json({
      error: 'Failed to delete package',
      message: error.message
    });
  }
});

module.exports = router;
