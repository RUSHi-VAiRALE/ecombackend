const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { db } = require('../firebase');

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

// Get user profile
router.get('/users/:userId/profile', verifyFirebaseToken, async (req, res) => {
  try {
    const { userId } = req.params;

    // Verify that the user is accessing their own profile or is admin
    // if (req.user.uid !== userId && !req.user.admin) {
    //   return res.status(403).json({ error: 'Forbidden: You can only access your own profile' });
    // }

    // Get user profile from Firestore
    const userDoc = await db.collection('users').doc(userId).get();
    const customerDoc = await db.collection('customers').doc(userId).get();

    let profileData = {
      userId: userId,
      email: req.user.email || '',
      firstName: '',
      lastName: '',
      phone: ''
    };

    if (userDoc.exists) {
      const userData = userDoc.data();
      profileData = {
        ...profileData,
        ...userData
      };
    }

    if (customerDoc.exists) {
      const customerData = customerDoc.data();

      // Extract name parts from contact_name
      if (customerData.contactName) {
        const nameParts = customerData.contactName.split(' ');
        profileData.firstName = nameParts[0] || '';
        profileData.lastName = nameParts.slice(1).join(' ') || '';
      }

      profileData.phone = customerData.phone || profileData.phone;
      profileData.email = customerData.email || profileData.email;
    }

    res.json(profileData);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Get user addresses (shipping and billing)
router.get('/users/:userId/addresses', verifyFirebaseToken, async (req, res) => {
  try {
    const { userId } = req.params;

    // Verify that the user is accessing their own addresses or is admin
    // if (req.user.uid !== userId && !req.user.admin) {
    //   return res.status(403).json({ error: 'Forbidden: You can only access your own addresses' });
    // }

    // Get customer data from Firestore
    const customerDoc = await db.collection('customers').doc(userId).get();

    let shippingAddress = null;
    let billingAddress = null;

    if (customerDoc.exists) {
      const customerData = customerDoc.data();

      // Process shipping address
      if (customerData.shippingAddress) {
        shippingAddress = customerData.shippingAddress;
      }

      // Process billing address
      if (customerData.billingAddress) {
        billingAddress = customerData.billingAddress;
      }
    }

    res.json({
      shippingAddress,
      billingAddress
    });
  } catch (error) {
    console.error('Error fetching user addresses:', error);
    res.status(500).json({ error: 'Failed to fetch user addresses' });
  }
});

// Update shipping address
router.post('/users/:userId/addresses/shipping', verifyFirebaseToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const addressData = req.body;

    // Verify that the user is updating their own address or is admin
    // if (req.user.uid !== userId && !req.user.admin) {
    //   return res.status(403).json({ error: 'Forbidden: You can only update your own address' });
    // }

    // Create shipping address object
    const shippingAddress = {
      addressLine1: addressData.addressLine1 || '',
      addressLine2: addressData.addressLine2 || '',
      city: addressData.city || '',
      state: addressData.state || '',
      postalCode: addressData.postalCode || '',
      country: addressData.country || 'India',
      phone: addressData.phone || '',
      name: addressData.name || ''
    };

    // Update customer document in Firestore
    const customerRef = db.collection('customers').doc(userId);
    await customerRef.set({
      shippingAddress: shippingAddress,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.status(200).json({
      success: true,
      message: 'Shipping address updated successfully',
      shippingAddress
    });
  } catch (error) {
    console.error('Error updating shipping address:', error);
    res.status(500).json({
      error: 'Failed to update shipping address',
      message: error.message
    });
  }
});

// Update billing address
router.post('/users/:userId/addresses/billing', verifyFirebaseToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const addressData = req.body;

    // Verify that the user is updating their own address or is admin
    // if (req.user.uid !== userId && !req.user.admin) {
    //   return res.status(403).json({ error: 'Forbidden: You can only update your own address' });
    // }

    // Create billing address object
    const billingAddress = {
      addressLine1: addressData.addressLine1 || '',
      addressLine2: addressData.addressLine2 || '',
      city: addressData.city || '',
      state: addressData.state || '',
      postalCode: addressData.postalCode || '',
      country: addressData.country || 'India',
      phone: addressData.phone || '',
      name: addressData.name || ''
    };

    // Update customer document in Firestore
    const customerRef = db.collection('customers').doc(userId);
    await customerRef.set({
      billingAddress: billingAddress,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.status(200).json({
      success: true,
      message: 'Billing address updated successfully',
      billingAddress
    });
  } catch (error) {
    console.error('Error updating billing address:', error);
    res.status(500).json({
      error: 'Failed to update billing address',
      message: error.message
    });
  }
});

// Get customer profile by email
router.get('/customers/profile', verifyFirebaseToken, async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required' });
    }

    // Verify that the token email matches the requested email
    if (email !== req.user.email) {
      return res.status(403).json({ error: 'Forbidden: Token email does not match requested email' });
    }

    // Query Firestore for customer with matching email
    const customersRef = db.collection('customers');
    const snapshot = await customersRef.where('email', '==', email).limit(1).get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'Customer profile not found' });
    }

    // Get the first matching document
    const customerDoc = snapshot.docs[0];
    const customerData = customerDoc.data();

    // Extract name parts from contact_name
    let firstName = '';
    let lastName = '';

    if (customerData.contactName) {
      const nameParts = customerData.contactName.split(' ');
      firstName = nameParts[0] || '';
      lastName = nameParts.slice(1).join(' ') || '';
    }

    // Prepare response object
    const profileData = {
      customerId: customerDoc.id,
      firstName: firstName,
      lastName: lastName,
      email: customerData.email,
      mobile: customerData.phone || '',
      shippingAddress: customerData.shippingAddress || null,
      billingAddress: customerData.billingAddress || null
    };

    res.json(profileData);
  } catch (error) {
    console.error('Error fetching customer profile:', error);
    res.status(500).json({ error: 'Failed to fetch customer profile' });
  }
});

// Get user orders with pagination
router.get('/users/:userId/orders', verifyFirebaseToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10, status } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // Verify that the requesting user matches the userId or is an admin
    // if (req.user.uid !== userId && !req.user.admin) {
    //   return res.status(403).json({ error: 'Forbidden: You can only access your own orders' });
    // }

    // Query to get orders for this user
    let ordersQuery = db.collection('orders')
      .where('customerId', '==', userId)
      .orderBy('createdAt', 'desc');

    // Add status filter if provided
    if (status) {
      ordersQuery = ordersQuery.where('status', '==', status);
    }

    // Get total count first (for pagination)
    const totalSnapshot = await ordersQuery.get();
    const totalOrders = totalSnapshot.size;

    // Then get paginated results
    const ordersSnapshot = await ordersQuery
      .limit(limitNum)
      .offset((pageNum - 1) * limitNum)
      .get();

    // Process orders
    const orders = [];
    for (const doc of ordersSnapshot.docs) {
      const orderData = doc.data();

      // Format the order data for the frontend
      orders.push({
        id: doc.id,
        orderId: orderData.orderId,
        date: orderData.createdAt ? orderData.createdAt.toDate() : null,
        status: orderData.status,
        paymentStatus: orderData.paymentStatus,
        paymentMethod: orderData.paymentMethod,
        totalAmount: orderData.totalAmount,
        items: orderData.items.map(item => ({
          productId: item.productId,
          productName: item.productName,
          productImage: item.productImage,
          quantity: item.quantity,
          price: item.price,
          shade: item.shade,
          shadeId: item.shadeId
        })),
        shippingAddress: orderData.shippingAddress,
        billingAddress: orderData.billingAddress,
        razorpayOrderId: orderData.razorpayOrderId,
        razorpayPaymentId: orderData.razorpayPaymentId
      });
    }

    // Return paginated results with metadata
    res.json({
      orders,
      pagination: {
        total: totalOrders,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(totalOrders / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ error: 'Failed to fetch user orders', message: error.message });
  }
});

// Get specific order details
router.get('/users/:userId/orders/:orderId', verifyFirebaseToken, async (req, res) => {
  try {
    const { userId, orderId } = req.params;

    // Verify that the requesting user matches the userId or is an admin
    // if (req.user.uid !== userId && !req.user.admin) {
    //   return res.status(403).json({ error: 'Forbidden: You can only access your own orders' });
    // }

    // Query for the specific order
    const orderSnapshot = await db.collection('orders')
      .where('customerId', '==', userId)
      .where('orderId', '==', orderId)
      .limit(1)
      .get();

    if (orderSnapshot.empty) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const orderDoc = orderSnapshot.docs[0];
    const orderData = orderDoc.data();

    // Format the order data for the frontend
    const orderDetails = {
      id: orderDoc.id,
      orderId: orderData.orderId,
      date: orderData.createdAt ? orderData.createdAt.toDate() : null,
      status: orderData.status,
      paymentStatus: orderData.paymentStatus,
      paymentMethod: orderData.paymentMethod,
      totalAmount: orderData.totalAmount,
      shippingCharges: orderData.shippingCharges || 0,
      discountAmount: orderData.discountAmount || 0,
      subtotal: orderData.subtotal || orderData.totalAmount,
      items: orderData.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        productImage: item.productImage,
        quantity: item.quantity,
        price: item.price,
        shade: item.shade,
        shadeId: item.shadeId,
        subtotal: item.quantity * item.price
      })),
      shippingAddress: orderData.shippingAddress,
      billingAddress: orderData.billingAddress,
      razorpayOrderId: orderData.razorpayOrderId,
      razorpayPaymentId: orderData.razorpayPaymentId
    };

    res.json(orderDetails);
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({ error: 'Failed to fetch order details', message: error.message });
  }
});

module.exports = router;
