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
      orderItems, 
      totalAmount, 
      customerId, 
      shippingAddress, 
      billingAddress,
      paymentMethod
    } = req.body;
    
    // Check if this is a COD order or a Razorpay order
    if (paymentMethod === 'cod') {
      // Create order in Firestore for COD
      console.log("online payment")
      const orderData = {
        orderId: 'ORD' + Date.now(),
        paymentMethod: 'cod',
        customerId: customerId,
        items: orderItems,
        totalAmount: totalAmount,
        shippingAddress: shippingAddress,
        billingAddress: billingAddress,
        status: 'pending',
        paymentStatus: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        user_email: req.user.email,
        user_id: req.user.uid
      };
      
      const newOrderRef = await db.collection('orders').add(orderData);
      
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
              notes: `Payment Method: Cash on Delivery`,
              billing_address: billingAddress,
              shipping_address: shippingAddress,
              payment_terms: 0, // Due on delivery
              payment_terms_label: "Due on Delivery"
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
            let zohoSalesOrderId = null;
            if (zohoResponse.data && zohoResponse.data.salesorder) {
              zohoSalesOrderId = zohoResponse.data.salesorder.salesorder_id;
              await newOrderRef.update({
                zohoSalesOrderId: zohoSalesOrderId
              });
              
              // Create Invoice with "Unpaid" status for COD
              const invoiceData = {
                customer_id: customerId,
                date: new Date().toISOString().split('T')[0],
                line_items: lineItems,
                reference_number: orderData.orderId,
                notes: `Payment Method: Cash on Delivery`,
                payment_terms: 0, // Due on delivery
                payment_terms_label: "Due on Delivery",
                is_inclusive_tax: false,
                salesperson_name: "Online Store",
                billing_address: billingAddress,
                shipping_address: shippingAddress,
                status: "unpaid", // Set status as unpaid for COD
                payment_expected_date: new Date().toISOString().split('T')[0] // Set expected payment date to today
              };
              
              const invoiceResponse = await axios.post(
                'https://www.zohoapis.in/inventory/v1/invoices',
                invoiceData,
                {
                  headers: {
                    'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
                    'Content-Type': 'application/json',
                    'organization_id': process.env.ZOHO_ORGANIZATION_ID || '60038401466'
                  }
                }
              );
              
              // Store invoice ID in Firestore
              if (invoiceResponse.data && invoiceResponse.data.invoice) {
                const invoiceId = invoiceResponse.data.invoice.invoice_id;
                await newOrderRef.update({
                  zohoInvoiceId: invoiceId
                });
              }
            }
          }
        } catch (zohoError) {
          console.error('Error in Zoho integration for COD order:', zohoError);
          // Continue with order creation even if Zoho integration fails
        }
      }
      
      res.status(201).json({ 
        success: true, 
        message: 'COD Order created successfully',
        orderId: orderData.orderId
      });
    } else {
      // This is the existing Razorpay payment flow
      const { paymentResponse } = req.body;
      console.log("online payment")
      // Verify payment signature
      const generated_signature = crypto.createHmac('sha256', "En7j4s7kTCKeIk6Go25vvwuX")
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
        paymentMethod: 'razorpay',
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
            let zohoSalesOrderId = null;
            if (zohoResponse.data && zohoResponse.data.salesorder) {
              zohoSalesOrderId = zohoResponse.data.salesorder.salesorder_id;
              await newOrderRef.update({
                zohoSalesOrderId: zohoSalesOrderId
              });
              
              // Create Invoice with "Unpaid" status first
              const invoiceData = {
                customer_id: customerId,
                date: new Date().toISOString().split('T')[0],
                line_items: lineItems,
                reference_number: orderData.orderId,
                notes: `Payment ID: ${paymentResponse.razorpay_payment_id}`,
                payment_terms: 0, // Due on receipt
                payment_terms_label: "Paid Online",
                is_inclusive_tax: false,
                salesperson_name: "Online Store",
                billing_address: billingAddress,
                shipping_address: shippingAddress,
                status: "paid", // Explicitly set status as unpaid
                payment_expected_date: new Date().toISOString().split('T')[0] // Set expected payment date to today
              };
              
              const invoiceResponse = await axios.post(
                'https://www.zohoapis.in/inventory/v1/invoices',
                invoiceData,
                {
                  headers: {
                    'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
                    'Content-Type': 'application/json',
                    'organization_id': process.env.ZOHO_ORGANIZATION_ID || '60038401466'
                  }
                }
              );
              
              // Store invoice ID in Firestore
              if (invoiceResponse.data && invoiceResponse.data.invoice) {
                const invoiceId = invoiceResponse.data.invoice.invoice_id;
                await newOrderRef.update({
                  zohoInvoiceId: invoiceId
                });
                
                // Create Customer Payment (mark invoice as paid)
                const paymentDate = new Date().toISOString().split('T')[0];
                const paymentData = {
                  customer_id: customerId,
                  payment_mode: "razorpay",
                  amount: totalAmount, // Convert from paise to rupees
                  date: paymentDate,
                  reference_number: paymentResponse.razorpay_payment_id,
                  description: `Payment for order ${orderData.orderId}`,
                  invoices: [
                    {
                      invoice_id: invoiceId,
                      amount_applied: totalAmount // Convert from paise to rupees
                    }
                  ],
                  exchange_rate: 1,
                  bank_charges: 0
                };
                
                const paymentResult = await axios.post(
                  'https://www.zohoapis.in/inventory/v1/customerpayments',
                  paymentData,
                  {
                    headers: {
                      'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
                      'Content-Type': 'application/json',
                      'organization_id': process.env.ZOHO_ORGANIZATION_ID || '60038401466'
                    }
                  }
                );
                
                // Store payment ID in Firestore
                if (paymentResult.data && paymentResult.data.payment) {
                  await newOrderRef.update({
                    zohoPaymentId: paymentResult.data.payment.payment_id
                  });
                }
              }
            }
          }
        } catch (zohoError) {
          console.error('Error in Zoho integration:', zohoError);
          // Continue with order creation even if Zoho integration fails
        }
      }
      
      res.status(201).json({ 
        success: true, 
        message: 'Order created successfully',
        orderId: orderData.orderId
      });
    }
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Get sales orders from Zoho
router.get('/orders/sales', verifyFirebaseToken, async (req, res) => {
  try {
    // Get tokens for Zoho API
    const tokensRef = db.collection('system').doc('zoho_tokens');
    const tokensDoc = await tokensRef.get();
    
    if (!tokensDoc.exists) {
      return res.status(500).json({ error: 'Zoho authentication not available' });
    }
    
    const tokens = tokensDoc.data();
    
    // Optional query parameters
    const { page = 1, limit = 25, status, customer_id, date_start, date_end } = req.query;
    
    // Build query string
    let queryParams = `?organization_id=${process.env.ZOHO_ORGANIZATION_ID || '60038401466'}&page=${page}&per_page=${limit}`;
    
    if (status) queryParams += `&status=${status}`;
    if (customer_id) queryParams += `&customer_id=${customer_id}`;
    if (date_start) queryParams += `&date_start=${date_start}`;
    if (date_end) queryParams += `&date_end=${date_end}`;
    
    // Fetch sales orders from Zoho
    const zohoResponse = await axios.get(
      `https://www.zohoapis.in/inventory/v1/salesorders`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Check if we have a valid response
    if (zohoResponse.data && zohoResponse.data.salesorders) {
      // Enhance the response with local order data if available
      const enhancedOrders = await Promise.all(zohoResponse.data.salesorders.map(async (order) => {
        // Try to find matching order in Firestore by reference number
        const localOrdersSnapshot = await db.collection('orders')
          .where('orderId', '==', order.reference_number)
          .limit(1)
          .get();
        
        if (!localOrdersSnapshot.empty) {
          const localOrderData = localOrdersSnapshot.docs[0].data();
          return {
            ...order,
            local_order_id: localOrdersSnapshot.docs[0].id,
            razorpay_payment_id: localOrderData.razorpayPaymentId,
            customer_email: localOrderData.user_email,
            items_detail: localOrderData.items,
            paymentMethod : localOrderData.paymentMethod
          };
        }
        
        return order;
      }));
      
      // Send enhanced response
      res.json({
        code: 0,
        message: 'success',
        page: parseInt(page),
        limit: parseInt(limit),
        total_count: zohoResponse.data.page_context?.total || enhancedOrders.length,
        salesorders: enhancedOrders
      });
    } else {
      res.json({
        code: 0,
        message: 'success',
        salesorders: []
      });
    }
  } catch (error) {
    console.error('Error fetching sales orders:', error);
    res.status(500).json({ 
      error: 'Failed to fetch sales orders',
      message: error.message
    });
  }
});

// Get specific sales order by ID
router.get('/orders/sales/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get tokens for Zoho API
    const tokensRef = db.collection('system').doc('zoho_tokens');
    const tokensDoc = await tokensRef.get();
    
    if (!tokensDoc.exists) {
      return res.status(500).json({ error: 'Zoho authentication not available' });
    }
    
    const tokens = tokensDoc.data();
    
    // Fetch specific sales order from Zoho
    const zohoResponse = await axios.get(
      `https://www.zohoapis.in/inventory/v1/salesorders/${id}?organization_id=${process.env.ZOHO_ORGANIZATION_ID || '60038401466'}`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Check if we have a valid response
    if (zohoResponse.data && zohoResponse.data.salesorder) {
      const order = zohoResponse.data.salesorder;
      
      // Try to find matching order in Firestore by reference number
      const localOrdersSnapshot = await db.collection('orders')
        .where('orderId', '==', order.reference_number)
        .limit(1)
        .get();
      
      let enhancedOrder = order;
      
      if (!localOrdersSnapshot.empty) {
        const localOrderData = localOrdersSnapshot.docs[0].data();
        enhancedOrder = {
          ...order,
          local_order_id: localOrdersSnapshot.docs[0].id,
          razorpay_payment_id: localOrderData.razorpayPaymentId,
          razorpay_order_id: localOrderData.razorpayOrderId,
          customer_email: localOrderData.user_email,
          items_detail: localOrderData.items,
          shipping_address: localOrderData.shippingAddress,
          billing_address: localOrderData.billingAddress
        };
      }
      
      // Send enhanced response
      res.json({
        code: 0,
        message: 'success',
        salesorder: enhancedOrder
      });
    } else {
      res.status(404).json({ error: 'Sales order not found' });
    }
  } catch (error) {
    console.error('Error fetching sales order:', error);
    res.status(500).json({ 
      error: 'Failed to fetch sales order',
      message: error.message
    });
  }
});

module.exports = router;