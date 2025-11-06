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

// Create a shipment
router.post('/create', verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const {
      orderId,
      orderDate,
      customerData,
      orderItems,
      shippingAddress,
      billingAddress,
      weight,
      length,
      width,
      height,
      paymentMethod,
      shippingCharges,
      subTotal,
      totalDiscount,
      trackingNumber,
      courierName,
      expectedDeliveryDate
    } = req.body;

    // Validate required fields
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    if (!shippingAddress) {
      return res.status(400).json({ error: 'Shipping address is required' });
    }

    if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
      return res.status(400).json({ error: 'Order items are required' });
    }

    // Verify order exists
    const orderSnapshot = await db.collection('orders')
      .where('orderId', '==', orderId)
      .limit(1)
      .get();

    if (orderSnapshot.empty) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const orderDateFormatted = orderDate || new Date().toISOString().split('T')[0];

    // Store shipment data in Firestore
    const shipmentRef = await db.collection('shipments').add({
      orderId: orderId,
      orderDate: orderDateFormatted,
      trackingNumber: trackingNumber || '',
      courierName: courierName || '',
      deliveryMethod: 'Standard Shipping',
      shipmentDate: orderDateFormatted,
      expectedDeliveryDate: expectedDeliveryDate || '',
      status: 'created',
      customerInfo: {
        name: customerData?.contactName || customerData?.name || 'Customer',
        phone: customerData?.phone || '',
        email: customerData?.email || ''
      },
      shippingAddress: shippingAddress,
      billingAddress: billingAddress,
      orderItems: orderItems,
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
      pricing: {
        subTotal: subTotal || 0,
        shippingCharges: shippingCharges || 0,
        totalDiscount: totalDiscount || 0,
        paymentMethod: paymentMethod || "Prepaid"
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.uid
    });

    res.status(201).json({
      success: true,
      message: 'Shipment created successfully',
      shipmentId: shipmentRef.id,
      orderId: orderId,
      trackingNumber: trackingNumber || '',
      courierName: courierName || ''
    });

  } catch (error) {
    console.error('Error creating shipment:', error);
    res.status(500).json({
      error: 'Failed to create shipment',
      message: error.message
    });
  }
});

// Get all shipments
router.get('/', verifyFirebaseToken, async (req, res) => {
  try {
    const { page = 1, limit = 25, orderId, status } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    let query = db.collection('shipments').orderBy('createdAt', 'desc');

    if (orderId) {
      query = query.where('orderId', '==', orderId);
    }

    if (status) {
      query = query.where('status', '==', status);
    }

    const snapshot = await query
      .limit(limitNum)
      .offset((pageNum - 1) * limitNum)
      .get();

    const shipments = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      shipments.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || null
      });
    });

    res.json({
      shipments: shipments,
      page: pageNum,
      limit: limitNum,
      total: shipments.length
    });
  } catch (error) {
    console.error('Error fetching shipments:', error);
    res.status(500).json({
      error: 'Failed to fetch shipments',
      message: error.message
    });
  }
});

// Get shipment by ID
router.get('/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;

    const shipmentDoc = await db.collection('shipments').doc(id).get();

    if (!shipmentDoc.exists) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    const shipmentData = shipmentDoc.data();
    res.json({
      id: shipmentDoc.id,
      ...shipmentData,
      createdAt: shipmentData.createdAt?.toDate?.() || null
    });
  } catch (error) {
    console.error('Error fetching shipment:', error);
    res.status(500).json({
      error: 'Failed to fetch shipment',
      message: error.message
    });
  }
});

// Update tracking information
router.put('/:id/tracking', verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { trackingNumber, courierName, status, expectedDeliveryDate } = req.body;

    if (!trackingNumber) {
      return res.status(400).json({ error: 'Tracking number is required' });
    }

    const shipmentRef = db.collection('shipments').doc(id);
    const shipmentDoc = await shipmentRef.get();

    if (!shipmentDoc.exists) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    const updateFields = {
      trackingNumber: trackingNumber,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.uid
    };

    if (courierName) {
      updateFields.courierName = courierName;
    }

    if (status) {
      updateFields.status = status;
    }

    if (expectedDeliveryDate) {
      updateFields.expectedDeliveryDate = expectedDeliveryDate;
    }

    await shipmentRef.update(updateFields);

    const updatedDoc = await shipmentRef.get();

    res.json({
      success: true,
      message: 'Tracking information updated successfully',
      shipment: {
        id: updatedDoc.id,
        ...updatedDoc.data()
      }
    });
  } catch (error) {
    console.error('Error updating tracking information:', error);
    res.status(500).json({
      error: 'Failed to update tracking information',
      message: error.message
    });
  }
});

// Update shipment status
router.put('/:id/status', verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const shipmentRef = db.collection('shipments').doc(id);
    const shipmentDoc = await shipmentRef.get();

    if (!shipmentDoc.exists) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    await shipmentRef.update({
      status: status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.uid
    });

    const updatedDoc = await shipmentRef.get();

    res.json({
      success: true,
      message: 'Shipment status updated successfully',
      shipment: {
        id: updatedDoc.id,
        ...updatedDoc.data()
      }
    });
  } catch (error) {
    console.error('Error updating shipment status:', error);
    res.status(500).json({
      error: 'Failed to update shipment status',
      message: error.message
    });
  }
});

module.exports = router;
