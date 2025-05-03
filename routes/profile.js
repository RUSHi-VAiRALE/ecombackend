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

// Get user profile (first name, last name, phone)
router.get('/users/:userId/profile', verifyFirebaseToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { email } = req.user;
    
    // Verify that the token email matches the requested user
    if (!email) {
      return res.status(403).json({ error: 'Forbidden: Token does not contain email' });
    }
    
    // Query Firestore for customer with matching email
    const customersRef = db.collection('customers');
    const snapshot = await customersRef.where('zohoContactId', '==', userId).limit(1).get();
    
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
      zohoContactId: customerData.zohoContactId,
      firstName: firstName,
      lastName: lastName,
      email: customerData.email,
      phone: customerData.phone || ''
    };
    
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
    const { email } = req.user;
    
    // Query Firestore for customer with matching email
    const customersRef = db.collection('customers');
    const snapshot = await customersRef.where('zohoContactId', '==', userId).limit(1).get();
    
    if (snapshot.empty) {
      return res.status(404).json({ error: 'Customer profile not found' });
    }
    
    // Get the first matching document
    const customerDoc = snapshot.docs[0];
    const customerData = customerDoc.data();
    
    // Process shipping and billing addresses
    let shippingAddress = null;
    if (customerData.zohoData && 
        customerData.zohoData.shipping_address && 
        customerData.zohoData.shipping_address.address) {
      
      const shipAddr = customerData.zohoData.shipping_address;
      
      // Only include address if it's not empty
      if (shipAddr.address.trim() !== '') {
        shippingAddress = {
          address: shipAddr.address,
          city: shipAddr.city || '',
          state: shipAddr.state || '',
          zip: shipAddr.zip || '',
          country: shipAddr.country || '',
          phone: shipAddr.phone || ''
        };
      }
    }
    
    let billingAddress = null;
    if (customerData.zohoData && 
        customerData.zohoData.billing_address && 
        customerData.zohoData.billing_address.address) {
      
      const billAddr = customerData.zohoData.billing_address;
      
      // Only include address if it's not empty
      if (billAddr.address.trim() !== '') {
        billingAddress = {
          address: billAddr.address,
          city: billAddr.city || '',
          state: billAddr.state || '',
          zip: billAddr.zip || '',
          country: billAddr.country || '',
          phone: billAddr.phone || ''
        };
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
    const { email } = req.user;
    const addressData = req.body;
    console.log(addressData)
    // Query Firestore for customer with matching email
    const customersRef = db.collection('customers');
    const snapshot = await customersRef.where('zohoContactId', '==', userId).limit(1).get();
    
    if (snapshot.empty) {
      return res.status(404).json({ error: 'Customer profile not found' });
    }
    
    // Get the first matching document
    const customerDoc = snapshot.docs[0];
    const customerData = customerDoc.data();
    
    // Create shipping address object for Firebase
    const shippingAddress = {
      address: addressData.addressLine1 || '',
      city: addressData.city || '',
      state: addressData.state || '',
      zip: addressData.postalCode || '',
      country: addressData.country || '',
      phone: addressData.phone || ''
    };
    
    // Create shipping address object for Zoho
    const zohoShippingAddress = {
      attention: customerData.contactName || '',
      address: addressData.addressLine1 || '',
      street2: addressData.addressLine2 || '',
      city: addressData.city || '',
      state: addressData.state || '',
      zip: addressData.postalCode || '',
      country: addressData.country || ''
    };
    
    // Get Zoho tokens
    const tokensRef = db.collection('system').doc('zoho_tokens');
    const tokensDoc = await tokensRef.get();
    
    if (!tokensDoc.exists) {
      return res.status(500).json({ error: 'Zoho authentication not available' });
    }
    
    const tokens = tokensDoc.data();
    
    // Start a Firestore transaction to ensure atomicity
    const transaction = db.runTransaction(async (t) => {
      // 1. First update Zoho
      try {
        const axios = require('axios');
        
        const zohoResponse = await axios({
          method: 'PUT',
          url: `https://www.zohoapis.in/inventory/v1/contacts/${userId}`,
          headers: {
            'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
            'Content-Type': 'application/json',
            'organization_id': process.env.ZOHO_ORGANIZATION_ID || '60038401466'
          },
          data: {
            shipping_address: zohoShippingAddress
          }
        });
        
        if (zohoResponse.status !== 200) {
          throw new Error(`Zoho API error: ${zohoResponse.statusText}`);
        }
        
        // 2. Then update Firestore
        if (!customerData.zohoData) {
          customerData.zohoData = {};
        }
        
        customerData.zohoData.shipping_address = {
          ...customerData.zohoData.shipping_address,
          ...shippingAddress,
          // Store the Zoho address_id if available
          address_id: zohoResponse.data.contact?.shipping_address?.address_id || 
                     customerData.zohoData.shipping_address?.address_id
        };
        
        // Update in transaction
        t.update(customerDoc.ref, {
          'zohoData.shipping_address': customerData.zohoData.shipping_address
        });
        
        return {
          success: true,
          zohoData: zohoResponse.data,
          shippingAddress
        };
      } catch (error) {
        console.error('Error in transaction:', error);
        throw error; // This will cause the transaction to fail and roll back
      }
    });
    
    const result = await transaction;
    
    res.status(200).json({
      success: true,
      message: 'Shipping address updated successfully in both Zoho and Firebase',
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
    const { email } = req.user;
    const addressData = req.body;
    
    // Query Firestore for customer with matching email
    const customersRef = db.collection('customers');
    const snapshot = await customersRef.where('zohoContactId', '==', userId).limit(1).get();
    
    if (snapshot.empty) {
      return res.status(404).json({ error: 'Customer profile not found' });
    }
    
    // Get the first matching document
    const customerDoc = snapshot.docs[0];
    const customerData = customerDoc.data();
    
    // Create billing address object for Firebase
    const billingAddress = {
      address: addressData.addressLine1 || '',
      city: addressData.city || '',
      state: addressData.state || '',
      zip: addressData.postalCode || '',
      country: addressData.country || '',
      phone: addressData.phone || ''
    };
    
    // Create billing address object for Zoho
    const zohoBillingAddress = {
      attention: customerData.contactName || '',
      address: addressData.addressLine1 || '',
      street2: addressData.addressLine2 || '',
      city: addressData.city || '',
      state: addressData.state || '',
      zip: addressData.postalCode || '',
      country: addressData.country || ''
    };
    
    // Get Zoho tokens
    const tokensRef = db.collection('system').doc('zoho_tokens');
    const tokensDoc = await tokensRef.get();
    
    if (!tokensDoc.exists) {
      return res.status(500).json({ error: 'Zoho authentication not available' });
    }
    
    const tokens = tokensDoc.data();
    
    // Start a Firestore transaction to ensure atomicity
    const transaction = db.runTransaction(async (t) => {
      // 1. First update Zoho
      try {
        const axios = require('axios');
        
        const zohoResponse = await axios({
          method: 'PUT',
          url: `https://www.zohoapis.in/inventory/v1/contacts/${userId}`,
          headers: {
            'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
            'Content-Type': 'application/json',
            'organization_id': process.env.ZOHO_ORGANIZATION_ID || '60038401466'
          },
          data: {
            billing_address: zohoBillingAddress
          }
        });
        
        if (zohoResponse.status !== 200) {
          throw new Error(`Zoho API error: ${zohoResponse.statusText}`);
        }
        
        // 2. Then update Firestore
        if (!customerData.zohoData) {
          customerData.zohoData = {};
        }
        
        customerData.zohoData.billing_address = {
          ...customerData.zohoData.billing_address,
          ...billingAddress,
          // Store the Zoho address_id if available
          address_id: zohoResponse.data.contact?.billing_address?.address_id || 
                     customerData.zohoData.billing_address?.address_id
        };
        
        // Update in transaction
        t.update(customerDoc.ref, {
          'zohoData.billing_address': customerData.zohoData.billing_address
        });
        
        return {
          success: true,
          zohoData: zohoResponse.data,
          billingAddress
        };
      } catch (error) {
        console.error('Error in transaction:', error);
        throw error; // This will cause the transaction to fail and roll back
      }
    });
    
    const result = await transaction;
    
    res.status(200).json({
      success: true,
      message: 'Billing address updated successfully in both Zoho and Firebase',
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

router.get('/customers/profile', verifyFirebaseToken, async (req, res) => {
  
    try {
      const { email } = req.query;
      console.log(req.query)
      if (!email) {
        return res.status(400).json({ error: 'Email parameter is required' });
      }
      
      // Verify that the token email matches the requested email
      if (email !== req.user.email) {
        return res.status(403).json({ error: 'Forbidden: Token email does not match requested email' });
      }
      
      // Query Firestore for customer with matching email
      const customersRef = admin.firestore().collection('customers')
      const snapshot = await customersRef.where('email', '==', email).limit(1).get();
      
      if (snapshot.empty) {
        return res.status(404).json({ error: 'Customer profile not found' });
      }
      
      // Get the first matching document
      const customerDoc = snapshot.docs[0];
      const customerData = customerDoc.data();
      console.log("data  ",customerData)
      // Process shipping and billing addresses
      
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
        customerId: customerData.zohoContactId,
        zohoContactId: customerData.zohoContactId,
        firstName: firstName,
        lastName: lastName,
        email: customerData.email,
        mobile: customerData.phone || '',
        shippingAddress: customerData.zohoData.shipping_address.address_id,
        billingAddress: customerData.zohoData.billing_address.address_id
      };
      console.log(profileData)
      res.json(profileData);
    } catch (error) {
      console.error('Error fetching customer profile:', error);
      res.status(500).json({ error: 'Failed to fetch customer profile' });
    }
  });

module.exports = router;