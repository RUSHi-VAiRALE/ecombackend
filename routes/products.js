const express = require('express');
const router = express.Router();
const { db, admin } = require('../firebase');
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
    
    // Check if user is admin
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    if (!userDoc.exists || !userDoc.data().isAdmin) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    
    next();
  } catch (error) {
    console.error('Error verifying Firebase token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Create a new product
router.post('/products', verifyFirebaseToken, async (req, res) => {
  try {
    const productData = req.body;
    
    // Validate required fields
    if (!productData.name || !productData.price) {
      return res.status(400).json({ error: 'Product name and price are required' });
    }
    
    // Generate a unique SKU if not provided
    if (!productData.sku) {
      productData.sku = 'SKU-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    }
    
    // Ensure images array exists
    if (!productData.images || !Array.isArray(productData.images)) {
      productData.images = [];
    }
    
    // Get Zoho tokens
    const tokensRef = db.collection('system').doc('zoho_tokens');
    const tokensDoc = await tokensRef.get();
    
    if (!tokensDoc.exists) {
      return res.status(500).json({ error: 'Zoho authentication not available' });
    }
    
    const tokens = tokensDoc.data();
    
    // Start a Firestore transaction
    const result = await db.runTransaction(async (transaction) => {
      try {
        // 1. Create item in Zoho Inventory
        const zohoItemData = {
          name: productData.name,
          sku: productData.sku,
          description: productData.description || '',
          rate: productData.price,
          purchase_rate: productData.originalPrice || productData.price,
          item_type: "inventory",
          product_type: "goods",
          unit: "qty",
        };
        
        const zohoResponse = await axios({
          method: 'POST',
          url: 'https://www.zohoapis.in/inventory/v1/items',
          headers: {
            'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
            'Content-Type': 'application/json',
            'organization_id': process.env.ZOHO_ORGANIZATION_ID || '60038401466'
          },
          data: zohoItemData
        });
        
        if (zohoResponse.status !== 201 && zohoResponse.status !== 200) {
          throw new Error(`Zoho API error: ${zohoResponse.statusText}`);
        }
        
        const zohoItemId = zohoResponse.data.item.item_id;
        
        // 2. Create product in Firebase
        const firebaseProductData = {
          id: zohoItemId,
          name: productData.name,
          subtitle: productData.subtitle || '',
          tagline: productData.tagline || '',
          price: productData.price,
          category : productData.category || '',
          originalPrice: productData.originalPrice || productData.price,
          discount: productData.discount || '',
          rating: productData.rating || 0,
          reviewCount: productData.reviewCount || 0,
          stockStatus: productData.stockStatus || 'In Stock',
          description: productData.description || '',
          longDescription: productData.longDescription || '',
          features: productData.features || [],
          howToUse: productData.howToUse || [],
          ingredients: productData.ingredients || '',
          images: productData.images,
          sku: productData.sku,
          zohoItemId: zohoItemId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        const productRef = db.collection('products').doc(firebaseProductData.id);
        transaction.set(productRef, firebaseProductData);
        
        return {
          success: true,
          productId: productRef.id,
          zohoItemId: zohoItemId,
          product: firebaseProductData
        };
      } catch (error) {
        console.error('Error in transaction:', error);
        throw error; // This will cause the transaction to fail and roll back
      }
    });
    
    res.status(201).json({
      success: true,
      message: 'Product created successfully in both Zoho and Firebase',
      productId: result.productId,
      zohoItemId: result.zohoItemId
    });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ 
      error: 'Failed to create product', 
      message: error.message 
    });
  }
});


module.exports = router;