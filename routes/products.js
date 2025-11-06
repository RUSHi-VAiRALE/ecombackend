const express = require('express');
const router = express.Router();
const { db, admin } = require('../firebase');

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

// Get all products
router.get('/products', verifyFirebaseToken, async (req, res) => {
  try {
    const { page = 1, limit = 25, category, search } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    
    let query = db.collection('products');
    
    if (category) {
      query = query.where('category', '==', category);
    }
    
    const snapshot = await query
      .orderBy('createdAt', 'desc')
      .limit(limitNum)
      .offset((pageNum - 1) * limitNum)
      .get();
    
    const products = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      products.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || null,
        updatedAt: data.updatedAt?.toDate?.() || null
      });
    });
    
    // Filter by search term if provided
    let filteredProducts = products;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredProducts = products.filter(p => 
        p.name?.toLowerCase().includes(searchLower) ||
        p.description?.toLowerCase().includes(searchLower) ||
        p.sku?.toLowerCase().includes(searchLower)
      );
    }
    
    res.json({
      products: filteredProducts,
      page: pageNum,
      limit: limitNum,
      total: filteredProducts.length
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Get product by ID
router.get('/products/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const productDoc = await db.collection('products').doc(id).get();
    
    if (!productDoc.exists) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    const productData = productDoc.data();
    res.json({
      id: productDoc.id,
      ...productData,
      createdAt: productData.createdAt?.toDate?.() || null,
      updatedAt: productData.updatedAt?.toDate?.() || null
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

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
    
    // Create product in Firebase
    const firebaseProductData = {
      name: productData.name,
      subtitle: productData.subtitle || '',
      tagline: productData.tagline || '',
      price: productData.price,
      category: productData.category || '',
      originalPrice: productData.originalPrice || productData.price,
      discount: productData.discount || '',
      rating: productData.rating || 0,
      reviewCount: productData.reviewCount || 0,
      stockStatus: productData.stockStatus || 'In Stock',
      stockQuantity: productData.stockQuantity || 0,
      description: productData.description || '',
      longDescription: productData.longDescription || '',
      features: productData.features || [],
      howToUse: productData.howToUse || [],
      ingredients: productData.ingredients || '',
      images: productData.images,
      sku: productData.sku,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const productRef = await db.collection('products').add(firebaseProductData);
    
    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      productId: productRef.id,
      product: {
        id: productRef.id,
        ...firebaseProductData
      }
    });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ 
      error: 'Failed to create product', 
      message: error.message 
    });
  }
});

// Update product
router.put('/products/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const productData = req.body;
    
    const productRef = db.collection('products').doc(id);
    const productDoc = await productRef.get();
    
    if (!productDoc.exists) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    const updateData = {
      ...productData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await productRef.update(updateData);
    
    const updatedDoc = await productRef.get();
    res.json({
      success: true,
      message: 'Product updated successfully',
      product: {
        id: updatedDoc.id,
        ...updatedDoc.data()
      }
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Delete product
router.delete('/products/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const productRef = db.collection('products').doc(id);
    const productDoc = await productRef.get();
    
    if (!productDoc.exists) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    await productRef.delete();
    
    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});


module.exports = router;