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
    
    // Create shipping address object
    const shippingAddress = {
      address: addressData.addressLine1 || '',
      city: addressData.city || '',
      state: addressData.state || '',
      zip: addressData.postalCode || '',
      country: addressData.country || '',
      phone: addressData.phone || ''
    };
    
    // Update the document in Firestore
    if (!customerData.zohoData) {
      customerData.zohoData = {};
    }
    
    customerData.zohoData.shipping_address = {
      ...customerData.zohoData.shipping_address,
      address: shippingAddress.address,
      city: shippingAddress.city,
      state: shippingAddress.state,
      zip: shippingAddress.zip,
      country: shippingAddress.country,
      phone: shippingAddress.phone
    };
    
    await customerDoc.ref.update({
      'zohoData.shipping_address': customerData.zohoData.shipping_address
    });
    
    res.status(200).json({
      success: true,
      message: 'Shipping address updated successfully',
      shippingAddress
    });
  } catch (error) {
    console.error('Error updating shipping address:', error);
    res.status(500).json({ error: 'Failed to update shipping address' });
  }
});

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
      console.log("data  ",customerData)
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
        mobile: customerData.phone || '',
        shippingAddress: shippingAddress,
        billingAddress: billingAddress
      };
      console.log(profileData)
      res.json(profileData);
    } catch (error) {
      console.error('Error fetching customer profile:', error);
      res.status(500).json({ error: 'Failed to fetch customer profile' });
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
    
    // Create billing address object
    const billingAddress = {
      address: addressData.addressLine1 || '',
      city: addressData.city || '',
      state: addressData.state || '',
      zip: addressData.postalCode || '',
      country: addressData.country || '',
      phone: addressData.phone || ''
    };
    
    // Update the document in Firestore
    if (!customerData.zohoData) {
      customerData.zohoData = {};
    }
    
    customerData.zohoData.billing_address = {
      ...customerData.zohoData.billing_address,
      address: billingAddress.address,
      city: billingAddress.city,
      state: billingAddress.state,
      zip: billingAddress.zip,
      country: billingAddress.country,
      phone: billingAddress.phone
    };
    
    await customerDoc.ref.update({
      'zohoData.billing_address': customerData.zohoData.billing_address
    });
    
    res.status(200).json({
      success: true,
      message: 'Billing address updated successfully',
      billingAddress
    });
  } catch (error) {
    console.error('Error updating billing address:', error);
    res.status(500).json({ error: 'Failed to update billing address' });
  }
});

module.exports = router;