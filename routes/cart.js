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

// Get user's cart
router.get('/', verifyFirebaseToken, async (req, res) => {
    try {
        const userId = req.user.uid;

        const cartDoc = await db.collection('carts').doc(userId).get();

        if (!cartDoc.exists) {
            return res.json({
                items: [],
                total: 0,
                itemCount: 0
            });
        }

        const cartData = cartDoc.data();

        // Calculate totals
        let total = 0;
        let itemCount = 0;

        if (cartData.items && Array.isArray(cartData.items)) {
            cartData.items.forEach(item => {
                total += (item.price || 0) * (item.quantity || 0);
                itemCount += item.quantity || 0;
            });
        }

        res.json({
            items: cartData.items || [],
            total: total,
            itemCount: itemCount,
            updatedAt: cartData.updatedAt
        });
    } catch (error) {
        console.error('Error fetching cart:', error);
        res.status(500).json({ error: 'Failed to fetch cart' });
    }
});

// Add item to cart
router.post('/add', verifyFirebaseToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { productId, quantity = 1, shade, shadeId, productName, productImage, price, productSku } = req.body;

        if (!productId) {
            return res.status(400).json({ error: 'Product ID is required' });
        }

        // Verify product exists
        const productDoc = await db.collection('products').doc(productId).get();
        if (!productDoc.exists) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const productData = productDoc.data();

        // Get or create cart
        const cartRef = db.collection('carts').doc(userId);
        const cartDoc = await cartRef.get();

        let items = [];
        if (cartDoc.exists) {
            items = cartDoc.data().items || [];
        }

        // Check if item already exists in cart
        const existingItemIndex = items.findIndex(
            item => item.productId === productId && item.shadeId === shadeId
        );

        if (existingItemIndex >= 0) {
            // Update quantity
            items[existingItemIndex].quantity += quantity;
        } else {
            // Add new item
            items.push({
                productId: productId,
                productName: productName || productData.name,
                productImage: productImage || (productData.images && productData.images[0]) || '',
                price: price || productData.price,
                quantity: quantity,
                shade: shade || '',
                shadeId: shadeId || '',
                productSku: productSku || productData.sku || '',
                addedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        // Update cart
        await cartRef.set({
            items: items,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            userId: userId
        }, { merge: true });

        res.json({
            success: true,
            message: 'Item added to cart',
            items: items
        });
    } catch (error) {
        console.error('Error adding item to cart:', error);
        res.status(500).json({ error: 'Failed to add item to cart' });
    }
});

// Update item quantity in cart
router.put('/update', verifyFirebaseToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { productId, quantity, shadeId } = req.body;

        if (!productId || quantity === undefined) {
            return res.status(400).json({ error: 'Product ID and quantity are required' });
        }

        if (quantity <= 0) {
            return res.status(400).json({ error: 'Quantity must be greater than 0' });
        }

        const cartRef = db.collection('carts').doc(userId);
        const cartDoc = await cartRef.get();

        if (!cartDoc.exists) {
            return res.status(404).json({ error: 'Cart not found' });
        }

        let items = cartDoc.data().items || [];

        // Find and update item
        const itemIndex = items.findIndex(
            item => item.productId === productId && item.shadeId === (shadeId || '')
        );

        if (itemIndex < 0) {
            return res.status(404).json({ error: 'Item not found in cart' });
        }

        items[itemIndex].quantity = quantity;
        items[itemIndex].updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await cartRef.update({
            items: items,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({
            success: true,
            message: 'Cart updated',
            items: items
        });
    } catch (error) {
        console.error('Error updating cart:', error);
        res.status(500).json({ error: 'Failed to update cart' });
    }
});

// Remove item from cart
router.delete('/remove', verifyFirebaseToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { productId, shadeId } = req.body;

        if (!productId) {
            return res.status(400).json({ error: 'Product ID is required' });
        }

        const cartRef = db.collection('carts').doc(userId);
        const cartDoc = await cartRef.get();

        if (!cartDoc.exists) {
            return res.status(404).json({ error: 'Cart not found' });
        }

        let items = cartDoc.data().items || [];

        // Remove item
        items = items.filter(
            item => !(item.productId === productId && item.shadeId === (shadeId || ''))
        );

        await cartRef.update({
            items: items,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({
            success: true,
            message: 'Item removed from cart',
            items: items
        });
    } catch (error) {
        console.error('Error removing item from cart:', error);
        res.status(500).json({ error: 'Failed to remove item from cart' });
    }
});

// Clear cart
router.delete('/clear', verifyFirebaseToken, async (req, res) => {
    try {
        const userId = req.user.uid;

        const cartRef = db.collection('carts').doc(userId);
        await cartRef.update({
            items: [],
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({
            success: true,
            message: 'Cart cleared'
        });
    } catch (error) {
        console.error('Error clearing cart:', error);
        res.status(500).json({ error: 'Failed to clear cart' });
    }
});

module.exports = router;

