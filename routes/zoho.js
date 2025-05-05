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

// Get all customers from Zoho
router.get('/customers', verifyFirebaseToken, async (req, res) => {
  try {
    // Get tokens for Zoho API
    const tokensRef = db.collection('system').doc('zoho_tokens');
    const tokensDoc = await tokensRef.get();
    
    if (!tokensDoc.exists) {
      return res.status(500).json({ error: 'Zoho authentication not available' });
    }
    
    const tokens = tokensDoc.data();
    
    // Optional query parameters
    const { page = 1, limit = 25, name, email, phone, status } = req.query;
    
    // Build query string
    let queryParams = `?organization_id=${process.env.ZOHO_ORGANIZATION_ID || '60038401466'}&page=${page}&per_page=${limit}`;
    
    if (name) queryParams += `&filter_by=name.contains:${encodeURIComponent(name)}`;
    if (email) queryParams += `&filter_by=email.contains:${encodeURIComponent(email)}`;
    if (phone) queryParams += `&filter_by=phone.contains:${encodeURIComponent(phone)}`;
    if (status) queryParams += `&filter_by=status.equals:${encodeURIComponent(status)}`;
    
    // Fetch customers from Zoho
    const zohoResponse = await axios.get(
      `https://www.zohoapis.in/inventory/v1/contacts${queryParams}`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Check if we have a valid response
    if (zohoResponse.data && zohoResponse.data.contacts) {
      // Enhance the response with local user data if available
      const enhancedCustomers = await Promise.all(zohoResponse.data.contacts.map(async (customer) => {
        // Try to find matching user in Firestore by email
        if (customer.email) {
          const userSnapshot = await db.collection('users')
            .where('email', '==', customer.email)
            .limit(1)
            .get();
          
          if (!userSnapshot.empty) {
            const userData = userSnapshot.docs[0].data();
            return {
              ...customer,
              firebase_uid: userSnapshot.docs[0].id,
              additional_info: userData.additionalInfo || {}
            };
          }
        }
        
        return customer;
      }));
      
      // Send enhanced response
      res.json({
        code: 0,
        message: 'success',
        page: parseInt(page),
        limit: parseInt(limit),
        total_count: zohoResponse.data.page_context?.total || enhancedCustomers.length,
        contacts: enhancedCustomers
      });
    } else {
      res.json({
        code: 0,
        message: 'success',
        contacts: []
      });
    }
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ 
      error: 'Failed to fetch customers',
      message: error.message
    });
  }
});

// Get specific customer by ID
router.get('/customers/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get tokens for Zoho API
    const tokensRef = db.collection('system').doc('zoho_tokens');
    const tokensDoc = await tokensRef.get();
    
    if (!tokensDoc.exists) {
      return res.status(500).json({ error: 'Zoho authentication not available' });
    }
    
    const tokens = tokensDoc.data();
    
    // Fetch specific customer from Zoho
    const zohoResponse = await axios.get(
      `https://www.zohoapis.in/inventory/v1/contacts/${id}?organization_id=${process.env.ZOHO_ORGANIZATION_ID || '60038401466'}`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Check if we have a valid response
    if (zohoResponse.data && zohoResponse.data.contact) {
      const customer = zohoResponse.data.contact;
      
      // Try to find matching user in Firestore by email
      let enhancedCustomer = customer;
      
      if (customer.email) {
        const userSnapshot = await db.collection('users')
          .where('email', '==', customer.email)
          .limit(1)
          .get();
        
        if (!userSnapshot.empty) {
          const userData = userSnapshot.docs[0].data();
          enhancedCustomer = {
            ...customer,
            firebase_uid: userSnapshot.docs[0].id,
            additional_info: userData.additionalInfo || {},
            orders: userData.orders || []
          };
        }
      }
      
      // Send enhanced response
      res.json({
        code: 0,
        message: 'success',
        contact: enhancedCustomer
      });
    } else {
      res.status(404).json({ error: 'Customer not found' });
    }
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ 
      error: 'Failed to fetch customer',
      message: error.message
    });
  }
});

// Get all payments from Zoho
router.get('/payments', verifyFirebaseToken, async (req, res) => {
  try {
    // Get tokens for Zoho API
    const tokensRef = db.collection('system').doc('zoho_tokens');
    const tokensDoc = await tokensRef.get();
    
    if (!tokensDoc.exists) {
      return res.status(500).json({ error: 'Zoho authentication not available' });
    }
    
    const tokens = tokensDoc.data();
    
    // Optional query parameters
    const { page = 1, limit = 25, customer_id, date_start, date_end, payment_mode } = req.query;
    
    // Build query string
    let queryParams = `?organization_id=${process.env.ZOHO_ORGANIZATION_ID || '60038401466'}&page=${page}&per_page=${limit}`;
    
    if (customer_id) queryParams += `&customer_id=${customer_id}`;
    if (date_start) queryParams += `&date_start=${date_start}`;
    if (date_end) queryParams += `&date_end=${date_end}`;
    if (payment_mode) queryParams += `&payment_mode=${payment_mode}`;
    
    // Fetch payments from Zoho
    const zohoResponse = await axios.get(
      `https://www.zohoapis.in/inventory/v1/customerpayments${queryParams}`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Check if we have a valid response
    if (zohoResponse.data && zohoResponse.data.customerpayments) {
      // Enhance the response with local order data if available
      const enhancedPayments = await Promise.all(zohoResponse.data.customerpayments.map(async (payment) => {
        // Try to find matching order in Firestore by reference number (which is the Razorpay payment ID)
        if (payment.reference_number) {
          const orderSnapshot = await db.collection('orders')
            .where('razorpayPaymentId', '==', payment.reference_number)
            .limit(1)
            .get();
          
          if (!orderSnapshot.empty) {
            const orderData = orderSnapshot.docs[0].data();
            return {
              ...payment,
              local_order_id: orderSnapshot.docs[0].id,
              order_number: orderData.orderId,
              items: orderData.items,
              user_email: orderData.user_email,
              user_id: orderData.user_id
            };
          }
        }
        
        return payment;
      }));
      
      // Send enhanced response
      res.json({
        code: 0,
        message: 'success',
        page: parseInt(page),
        limit: parseInt(limit),
        total_count: zohoResponse.data.page_context?.total || enhancedPayments.length,
        customerpayments: enhancedPayments
      });
    } else {
      res.json({
        code: 0,
        message: 'success',
        customerpayments: []
      });
    }
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ 
      error: 'Failed to fetch payments',
      message: error.message
    });
  }
});

// Get specific payment by ID
router.get('/payments/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get tokens for Zoho API
    const tokensRef = db.collection('system').doc('zoho_tokens');
    const tokensDoc = await tokensRef.get();
    
    if (!tokensDoc.exists) {
      return res.status(500).json({ error: 'Zoho authentication not available' });
    }
    
    const tokens = tokensDoc.data();
    
    // Fetch specific payment from Zoho
    const zohoResponse = await axios.get(
      `https://www.zohoapis.in/inventory/v1/customerpayments/${id}?organization_id=${process.env.ZOHO_ORGANIZATION_ID || '60038401466'}`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Check if we have a valid response
    if (zohoResponse.data && zohoResponse.data.customerpayment) {
      const payment = zohoResponse.data.customerpayment;
      
      // Try to find matching order in Firestore by reference number (which is the Razorpay payment ID)
      let enhancedPayment = payment;
      
      if (payment.reference_number) {
        const orderSnapshot = await db.collection('orders')
          .where('razorpayPaymentId', '==', payment.reference_number)
          .limit(1)
          .get();
        
        if (!orderSnapshot.empty) {
          const orderData = orderSnapshot.docs[0].data();
          enhancedPayment = {
            ...payment,
            local_order_id: orderSnapshot.docs[0].id,
            order_number: orderData.orderId,
            items: orderData.items,
            user_email: orderData.user_email,
            user_id: orderData.user_id,
            shipping_address: orderData.shippingAddress,
            billing_address: orderData.billingAddress
          };
        }
      }
      
      // Send enhanced response
      res.json({
        code: 0,
        message: 'success',
        customerpayment: enhancedPayment
      });
    } else {
      res.status(404).json({ error: 'Payment not found' });
    }
  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({ 
      error: 'Failed to fetch payment',
      message: error.message
    });
  }
});

module.exports = router;