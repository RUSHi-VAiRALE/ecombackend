const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const admin = require('firebase-admin');
const axios = require('axios');

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

// Get Zoho tokens helper function
const getZohoTokens = async () => {
  const tokensRef = db.collection('system').doc('zoho_tokens');
  const tokensDoc = await tokensRef.get();
  
  if (!tokensDoc.exists) {
    throw new Error('Zoho authentication not available');
  }
  
  return tokensDoc.data();
};

// Create a new package in Zoho
router.post('/create', verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const {
      salesOrderId,
      packageName,
      packageNumber,
      length,
      width,
      height,
      weight,
      items
    } = req.body;
    console.log("reqBody : " ,req.body)
    // Validate required fields
    if (!salesOrderId) {
      return res.status(400).json({ error: 'Sales order ID is required' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Package items are required' });
    }

    // Get Zoho tokens
    const tokens = await getZohoTokens();

    // Prepare package data
    const packageData = {
      salesorder_id: salesOrderId,
      date: new Date().toISOString().split('T')[0],
      package_name: packageName || `Package for ${salesOrderId}`,
      line_items: items.map(item => ({
        so_line_item_id: item.lineItemId,
        quantity: item.quantity
      })),
      dimensions: {
        length: length || 10,
        width: width || 10,
        height: height || 10,
        unit: "cm"
      },
      weight: {
        weight: weight || 500,
        unit: "g"
      }
    };

    // Use axios to make the request to Zoho
    const zohoResponse = await axios.post(
      `https://www.zohoapis.in/inventory/v1/packages?organization_id=${process.env.ZOHO_ORGANIZATION_ID || '60038401466'}&salesorder_id=${salesOrderId}`,
      packageData,
      {
        headers: {
          "Authorization": `Zoho-oauthtoken ${tokens.access_token}`,
          "content-type": "application/json"
        }
      }
    );

    if (!zohoResponse.data || !zohoResponse.data.package) {
      return res.status(500).json({ error: 'Failed to create package in Zoho', zohoResponse: zohoResponse.data });
    }

    // Store package data in Firestore
    const zohoPackage = zohoResponse.data.package;
    await db.collection('packages').add({
      zohoPackageId: zohoPackage.package_id,
      zohoSalesOrderId: salesOrderId,
      packageName: packageName || `Package for ${salesOrderId}`,
      packageNumber: packageNumber || `PKG-${Date.now()}`,
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
      status: zohoPackage.status || 'created',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.uid,
      zohoData: zohoPackage
    });

    res.status(201).json({
      success: true,
      message: 'Package created successfully',
      package: zohoPackage
    });
  } catch (error) {
    console.error('Error creating package:', error);
    res.status(500).json({
      error: 'Failed to create package',
      message: error.response?.data?.message || error.message
    });
  }
});

// Get all packages
router.get('/', verifyFirebaseToken, async (req, res) => {
  try {
    const { page = 1, limit = 25, salesOrderId } = req.query;
    
    // Get Zoho tokens
    const tokens = await getZohoTokens();
    
    // Build query string
    let queryParams = `?organization_id=${process.env.ZOHO_ORGANIZATION_ID || '60038401466'}&page=${page}&per_page=${limit}`;
    
    if (salesOrderId) {
      queryParams += `&salesorder_id=${salesOrderId}`;
    }
    
    // Fetch packages from Zoho
    const zohoResponse = await axios.get(
      `https://www.zohoapis.in/inventory/v1/packages${queryParams}`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    res.json(zohoResponse.data);
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.status(500).json({ 
      error: 'Failed to fetch packages', 
      message: error.response?.data?.message || error.message 
    });
  }
});

// Get package by ID
router.get('/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get Zoho tokens
    const tokens = await getZohoTokens();
    
    // Fetch package from Zoho
    const zohoResponse = await axios.get(
      `https://www.zohoapis.in/inventory/v1/packages/${id}?organization_id=${process.env.ZOHO_ORGANIZATION_ID || '60038401466'}`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    res.json(zohoResponse.data);
  } catch (error) {
    console.error('Error fetching package:', error);
    res.status(500).json({ 
      error: 'Failed to fetch package', 
      message: error.response?.data?.message || error.message 
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
      items
    } = req.body;
    
    // Get Zoho tokens
    const tokens = await getZohoTokens();
    
    // Prepare update data
    const updateData = {};
    
    if (packageName) updateData.package_name = packageName;
    
    if (length || width || height) {
      updateData.dimensions = {
        length: length || 10,
        width: width || 10,
        height: height || 10,
        unit: "cm"
      };
    }
    
    if (weight) {
      updateData.weight = {
        weight: weight,
        unit: "g"
      };
    }
    
    if (items && Array.isArray(items) && items.length > 0) {
      updateData.line_items = items.map(item => ({
        line_item_id: item.lineItemId,
        quantity: item.quantity
      }));
    }
    
    // Update package in Zoho
    const packageResponse = await axios.put(
      `https://www.zohoapis.in/inventory/v1/packages/${id}`,
      updateData,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
          'Content-Type': 'application/json',
          'organization_id': process.env.ZOHO_ORGANIZATION_ID || '60038401466'
        }
      }
    );
    
    // Update package in Firestore
    if (packageResponse.data && packageResponse.data.package) {
      const zohoPackage = packageResponse.data.package;
      
      // Find the package in Firestore
      const packagesSnapshot = await db.collection('packages')
        .where('zohoPackageId', '==', id)
        .limit(1)
        .get();
      
      if (!packagesSnapshot.empty) {
        const packageDoc = packagesSnapshot.docs[0];
        
        const updateFields = {};
        
        if (packageName) updateFields.packageName = packageName;
        
        if (length || width || height) {
          updateFields.dimensions = {
            length: length || packageDoc.data().dimensions.length,
            width: width || packageDoc.data().dimensions.width,
            height: height || packageDoc.data().dimensions.height,
            unit: "cm"
          };
        }
        
        if (weight) {
          updateFields.weight = {
            weight: weight,
            unit: "g"
          };
        }
        
        if (items && Array.isArray(items) && items.length > 0) {
          updateFields.items = items;
        }
        
        updateFields.zohoData = zohoPackage;
        updateFields.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        
        await packageDoc.ref.update(updateFields);
      }
    }
    
    res.json({
      success: true,
      message: 'Package updated successfully',
      package: packageResponse.data.package
    });
  } catch (error) {
    console.error('Error updating package:', error);
    res.status(500).json({ 
      error: 'Failed to update package', 
      message: error.response?.data?.message || error.message 
    });
  }
});

module.exports = router;