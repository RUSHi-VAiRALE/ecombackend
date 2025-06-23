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

// Verify admin middleware
const verifyAdmin = async (req, res, next) => {
  if (!req.user || !req.user.admin) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
};

// Get Zoho tokens helper function
const getZohoTokens = async () => {
  const tokensRef = db.collection('system').doc('zoho_tokens');
  const tokensDoc = await tokensRef.get();

  if (!tokensDoc.exists) {
    throw new Error('Zoho authentication not available');
  }

  return tokensDoc.data();
};

// Get ShipRocket token
const getShipRocketToken = async () => {
  // Check if we have a valid token in Firestore
  const tokenRef = db.collection('system').doc('shiprocket_token');
  const tokenDoc = await tokenRef.get();

  if (tokenDoc.exists) {
    const tokenData = tokenDoc.data();
    // Check if token is still valid (not expired)
    if (tokenData.expires_at && tokenData.expires_at > Date.now()) {
      return tokenData.token;
    }
  }

  // If no valid token, get a new one
  const response = await axios.post('https://apiv2.shiprocket.in/v1/external/auth/login', {
    email: "nikhil.zencodx@gmail.com",
    password: "S9rIoU&iNayH!3Rj"
  });

  if (response.data && response.data.token) {
    // Store token in Firestore with expiration (token valid for 24 hours)
    console.log('ShipRocket token:', response.data);
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
    await tokenRef.set({
      token: response.data.token,
      created_at: Date.now(),
      expires_at: expiresAt
    });

    return response.data.token;
  } else {
    throw new Error('Failed to authenticate with ShipRocket');
  }
};

// Create a shipment directly in ShipRocket
router.post('/create', verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    console.log("req.body", req.body);
    const {
      // Order Information
      orderId,
      orderDate,

      // Customer Information
      customerData,
      pickupLocation,

      // Order Items
      orderItems,

      // Addresses
      shippingAddress,
      billingAddress,

      // Package Information
      weight,
      length,
      width,
      height,

      // Payment & Shipping
      paymentMethod,
      shippingCharges,
      subTotal,
      totalDiscount,

      // Optional fields
      deliveryMethod,
      courierName,
      expectedDeliveryDate
    } = req.body;

    // Validate required fields
    if (!shippingAddress) {
      return res.status(400).json({ error: 'Shipping address is required' });
    }

    if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
      return res.status(400).json({ error: 'Order items are required' });
    }

    // Get ShipRocket token
    const shipRocketToken = await getShipRocketToken();

    // Format address for ShipRocket
    const formatAddress = (address) => {
      return {
        name: address.name || 'Customer',
        address: address.address || address.line1 || '',
        address_2: address.address2 || address.line2 || '',
        city: address.city || '',
        state: address.state || '',
        country: address.country || 'India',
        pin_code: address.pinCode || address.zipCode || address.postalCode || '',
        phone: address.phone || ''
      };
    };

    // Generate order ID if not provided
    const generatedOrderId = orderId || `ORD-${Date.now()}`;
    const orderDateFormatted = orderDate || new Date().toISOString().split('T')[0];

    // Prepare ShipRocket order data with fallback dummy data
    const shipRocketOrderData = {
      order_id: generatedOrderId,
      order_date: orderDateFormatted,
      pickup_location: "Home",

      // Billing Information
      billing_customer_name: customerData.contactName,
      billing_last_name: "",
      billing_address: billingAddress ? formatAddress(billingAddress).address : "123 Test Street",
      billing_address_2: billingAddress ? formatAddress(billingAddress).address_2 : "",
      billing_city: billingAddress?.city || "Mumbai",
      billing_pincode: billingAddress?.pinCode || billingAddress?.zipCode || "400001",
      billing_state: billingAddress?.state || "Maharashtra",
      billing_country: billingAddress?.country || "India",
      billing_phone: customerData.phone,
      billing_email: customerData.email || "customer@example.com",

      // Shipping Information
      shipping_customer_name: customerData.contactName,
      shipping_last_name: "",
      shipping_address: formatAddress(shippingAddress).address || "123 Test Street",
      shipping_address_2: formatAddress(shippingAddress).address_2,
      shipping_city: shippingAddress?.city || "Mumbai",
      shipping_pincode: shippingAddress?.pinCode || shippingAddress?.zipCode || "400001",
      shipping_state: shippingAddress?.state || "Maharashtra",
      shipping_country: shippingAddress?.country || "India",
      shipping_phone: customerData.phone,
      shipping_email: customerData.email || "customer@example.com",

      // Order Items - validate and format
      order_items: orderItems.map((item, index) => ({
        name: item.name || `Product ${index + 1}`,
        sku: item.sku || `SKU-${Date.now()}-${index}`,
        units: item.quantity || item.units || 1,
        selling_price: item.price || item.sellingPrice || item.selling_price || 100,
        discount: item.discount || 0,
        tax: item.tax || item.taxPercentage || 0,
        hsn: item.hsn || item.hsnCode || ""
      })),

      // Payment and charges
      payment_method: (paymentMethod === "razorpay") ? "Prepaid" : "COD",
      shipping_is_billing: true,
      shipping_charges: shippingCharges || 0,
      giftwrap_charges: 0,
      transaction_charges: 0,
      total_discount: totalDiscount || 0,
      sub_total: subTotal || orderItems.reduce((sum, item) => sum + ((item.price || item.sellingPrice || 100) * (item.quantity || 1)), 0),

      // Package dimensions
      length: length || 10,
      breadth: width || 10,
      height: height || 10,
      weight: weight || 500
    };

    console.log('ShipRocket Order Data:', JSON.stringify(shipRocketOrderData, null, 2));

    // Create order in ShipRocket
    const shipRocketOrderResponse = await axios.post(
      'https://apiv2.shiprocket.in/v1/external/orders/create/adhoc',
      shipRocketOrderData,
      {
        headers: {
          'Authorization': `Bearer ${shipRocketToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('ShipRocket Order Response:', shipRocketOrderResponse);
    // Store shipment data in Firestore
    const shipmentRef = await db.collection('shipments').add({
      orderId: generatedOrderId,
      shipRocketOrderId: shipRocketOrderResponse.data?.order_id,
      shipRocketShipmentId: shipRocketOrderResponse.data?.shipment_id,
      trackingNumber: shipRocketOrderResponse.data?.tracking_number || '',
      courierName: courierName || shipRocketOrderResponse.data?.courier_name || 'ShipRocket',
      deliveryMethod: deliveryMethod || 'Standard Shipping',
      shipmentDate: orderDateFormatted,
      expectedDeliveryDate: expectedDeliveryDate || '',
      status: 'created',
      customerInfo: {
        name: customerData.contactName,
        phone: customerData.phone,
        email: customerData.email
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
      createdBy: req.user.uid,
      shipRocketData: shipRocketOrderResponse.data || {},
      originalRequestData: req.body // Store original request for debugging
    });

    res.status(201).json({
      success: true,
      message: 'ShipRocket order created successfully',
      shipmentId: shipmentRef.id,
      orderId: generatedOrderId,
      shipRocketOrder: shipRocketOrderResponse.data,
      trackingNumber: shipRocketOrderResponse.data?.tracking_number,
      shipmentId: shipRocketOrderResponse.data?.shipment_id
    });

  } catch (error) {
    console.error('Error creating ShipRocket order:', error);
    console.error('Error response:', error.response?.data);
    res.status(500).json({
      error: 'Failed to create ShipRocket order',
      message: error.response?.data?.message || error.message,
      details: error.response?.data
    });
  }
});

// Get all shipments
router.get('/', verifyFirebaseToken, async (req, res) => {
  try {
    const { page = 1, limit = 25, salesOrderId, packageId } = req.query;

    // Get Zoho tokens
    const tokens = await getZohoTokens();

    // Build query string
    let queryParams = `?organization_id=${process.env.ZOHO_ORGANIZATION_ID || '60038401466'}&page=${page}&per_page=${limit}`;

    if (salesOrderId) {
      queryParams += `&salesorder_id=${salesOrderId}`;
    }

    if (packageId) {
      queryParams += `&package_id=${packageId}`;
    }

    // Fetch shipments from Zoho
    const zohoResponse = await axios.get(
      `https://www.zohoapis.in/inventory/v1/shipments${queryParams}`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Enhance with ShipRocket data if available
    if (zohoResponse.data && zohoResponse.data.shipments) {
      const enhancedShipments = await Promise.all(zohoResponse.data.shipments.map(async (shipment) => {
        // Try to find matching shipment in Firestore
        const shipmentSnapshot = await db.collection('shipments')
          .where('zohoShipmentId', '==', shipment.shipment_id)
          .limit(1)
          .get();

        if (!shipmentSnapshot.empty) {
          const shipmentData = shipmentSnapshot.docs[0].data();
          return {
            ...shipment,
            shipRocketOrderId: shipmentData.shipRocketOrderId,
            shipRocketShipmentId: shipmentData.shipRocketShipmentId,
            trackingUrl: shipmentData.shipRocketData?.tracking_url || '',
            courierName: shipmentData.courierName,
            firebaseId: shipmentSnapshot.docs[0].id
          };
        }

        return shipment;
      }));

      zohoResponse.data.shipments = enhancedShipments;
    }

    res.json(zohoResponse.data);
  } catch (error) {
    console.error('Error fetching shipments:', error);
    res.status(500).json({
      error: 'Failed to fetch shipments',
      message: error.response?.data?.message || error.message
    });
  }
});

// Get shipment by ID
router.get('/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get Zoho tokens
    const tokens = await getZohoTokens();

    // Fetch shipment from Zoho
    const zohoResponse = await axios.get(
      `https://www.zohoapis.in/inventory/v1/shipments/${id}?organization_id=${process.env.ZOHO_ORGANIZATION_ID || '60038401466'}`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Enhance with ShipRocket data if available
    if (zohoResponse.data && zohoResponse.data.shipment) {
      // Try to find matching shipment in Firestore
      const shipmentSnapshot = await db.collection('shipments')
        .where('zohoShipmentId', '==', id)
        .limit(1)
        .get();

      if (!shipmentSnapshot.empty) {
        const shipmentData = shipmentSnapshot.docs[0].data();

        // If we have ShipRocket data, get tracking details
        if (shipmentData.shipRocketOrderId) {
          try {
            const shipRocketToken = await getShipRocketToken();

            const trackingResponse = await axios.get(
              `https://apiv2.shiprocket.in/v1/external/courier/track/shipment/${shipmentData.shipRocketShipmentId}`,
              {
                headers: {
                  'Authorization': `Bearer ${shipRocketToken}`,
                  'Content-Type': 'application/json'
                }
              }
            );

            zohoResponse.data.shipment.shipRocketTracking = trackingResponse.data;
          } catch (trackingError) {
            console.error('Error fetching ShipRocket tracking:', trackingError);
            // Continue without tracking data if there's an error
          }
        }

        zohoResponse.data.shipment = {
          ...zohoResponse.data.shipment,
          shipRocketOrderId: shipmentData.shipRocketOrderId,
          shipRocketShipmentId: shipmentData.shipRocketShipmentId,
          trackingUrl: shipmentData.shipRocketData?.tracking_url || '',
          courierName: shipmentData.courierName,
          firebaseId: shipmentSnapshot.docs[0].id
        };
      }
    }

    res.json(zohoResponse.data);
  } catch (error) {
    console.error('Error fetching shipment:', error);
    res.status(500).json({
      error: 'Failed to fetch shipment',
      message: error.response?.data?.message || error.message
    });
  }
});

// Update tracking information
router.put('/:id/tracking', verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { trackingNumber, courierName } = req.body;

    if (!trackingNumber) {
      return res.status(400).json({ error: 'Tracking number is required' });
    }

    // Get Zoho tokens
    const tokens = await getZohoTokens();

    // Update shipment in Zoho
    const updateData = {
      tracking_number: trackingNumber,
      notes: `Courier: ${courierName || 'ShipRocket'}`
    };

    const zohoResponse = await axios.put(
      `https://www.zohoapis.in/inventory/v1/shipments/${id}`,
      updateData,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
          'Content-Type': 'application/json',
          'organization_id': process.env.ZOHO_ORGANIZATION_ID || '60038401466'
        }
      }
    );

    // Update shipment in Firestore
    const shipmentSnapshot = await db.collection('shipments')
      .where('zohoShipmentId', '==', id)
      .limit(1)
      .get();

    if (!shipmentSnapshot.empty) {
      const shipmentDoc = shipmentSnapshot.docs[0];

      await shipmentDoc.ref.update({
        trackingNumber: trackingNumber,
        courierName: courierName || shipmentDoc.data().courierName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: req.user.uid
      });
    }

    res.json({
      success: true,
      message: 'Tracking information updated successfully',
      shipment: zohoResponse.data.shipment
    });
  } catch (error) {
    console.error('Error updating tracking information:', error);
    res.status(500).json({
      error: 'Failed to update tracking information',
      message: error.response?.data?.message || error.message
    });
  }
});

module.exports = router;