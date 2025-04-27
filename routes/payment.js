const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
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

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_VHhB5zXuk19mbh',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'En7j4s7kTCKeIk6Go25vvwuX'
});

// Create Razorpay order
router.post('/payment/create-order', verifyFirebaseToken, async (req, res) => {
  try {
    const { amount, currency, items } = req.body;
    
    // Create order options
    const options = {
      amount: amount, // amount in smallest currency unit (paise)
      currency: currency || 'INR',
      receipt: 'order_' + Date.now(),
      notes: {
        items_count: items,
        user_email: req.user.email
      }
    };
    
    // Create order in Razorpay
    const order = await razorpay.orders.create(options);
    
    // Store order in Firestore for reference
    await db.collection('razorpay_orders').doc(order.id).set({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      user_email: req.user.email,
      user_id: req.user.uid
    });
    
    res.json(order);
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// Create order and verify payment
router.post('/orders/create', verifyFirebaseToken, async (req, res) => {
  try {
    const { 
      paymentResponse, 
      orderItems, 
      totalAmount, 
      customerId, 
      shippingAddress, 
      billingAddress 
    } = req.body;
    
    // Verify payment signature
    const generated_signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'your_razorpay_secret')
      .update(paymentResponse.razorpay_order_id + '|' + paymentResponse.razorpay_payment_id)
      .digest('hex');
    
    if (generated_signature !== paymentResponse.razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }
    
    // Get Razorpay order details from Firestore
    const orderRef = db.collection('razorpay_orders').doc(paymentResponse.razorpay_order_id);
    const orderDoc = await orderRef.get();
    
    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Create order in Firestore
    const orderData = {
      orderId: 'ORD' + Date.now(),
      razorpayOrderId: paymentResponse.razorpay_order_id,
      razorpayPaymentId: paymentResponse.razorpay_payment_id,
      razorpaySignature: paymentResponse.razorpay_signature,
      customerId: customerId,
      items: orderItems,
      totalAmount: totalAmount,
      shippingAddress: shippingAddress,
      billingAddress: billingAddress,
      status: 'confirmed',
      paymentStatus: 'paid',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      user_email: req.user.email,
      user_id: req.user.uid
    };
    
    const newOrderRef = await db.collection('orders').add(orderData);
    
    // Update Razorpay order status
    await orderRef.update({
      payment_id: paymentResponse.razorpay_payment_id,
      payment_signature: paymentResponse.razorpay_signature,
      status: 'paid',
      order_document_id: newOrderRef.id
    });
    
    // Create sales order in Zoho Inventory if customerId exists
    if (customerId) {
      try {
        // Get tokens for Zoho API
        const tokensRef = db.collection('system').doc('zoho_tokens');
        const tokensDoc = await tokensRef.get();
        
        if (tokensDoc.exists) {
          const tokens = tokensDoc.data();
          
          // Prepare line items for Zoho
          const lineItems = orderItems.map(item => ({
            item_id: item.productId,
            name: item.productName,
            quantity: item.quantity,
            rate: item.price,
            description: `Shade: ${item.shade || 'N/A'}`
          }));
          
          // Create sales order in Zoho
          const salesOrderData = {
            customer_id: customerId,
            date: new Date().toISOString().split('T')[0],
            line_items: lineItems,
            reference_number: orderData.orderId,
            notes: `Payment ID: ${paymentResponse.razorpay_payment_id}`,
            billing_address: billingAddress,
            shipping_address: shippingAddress
          };
          
          const zohoResponse = await axios.post(
            'https://www.zohoapis.in/inventory/v1/salesorders',
            salesOrderData,
            {
              headers: {
                'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
                'Content-Type': 'application/json',
                'organization_id': process.env.ZOHO_ORGANIZATION_ID || '60038401466'
              }
            }
          );
          
          // Update order with Zoho sales order ID
          if (zohoResponse.data && zohoResponse.data.salesorder) {
            await newOrderRef.update({
              zohoSalesOrderId: zohoResponse.data.salesorder.salesorder_id
            });
          }
        }
      } catch (zohoError) {
        console.error('Error creating Zoho sales order:', zohoError);
        // Continue with order creation even if Zoho integration fails
      }
    }
    
    res.status(201).json({ 
      success: true, 
      message: 'Order created successfully',
      orderId: orderData.orderId
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

module.exports = router;