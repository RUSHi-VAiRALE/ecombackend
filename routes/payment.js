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

// ShipRocket authentication function
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
    email: "princelookspure@gmail.com",
    password: "UIw&ac@X&3UEeQqH"
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
      paymentMethod,
      // Additional fields from new request structure
      customer,
      cartItems,
      cartTotal,
      shippingCharges,
      discountAmount,
      shiprocketData
    } = req.body;

    // Check if this is a COD order or a Razorpay order
    if (paymentMethod === 'cod') {
      // Create order in Firestore for COD
      console.log("online payment")
      const orderData = {
        orderId: 'ORD' + Date.now(),
        paymentMethod: 'cod',
        customerId: customer?.customerId,
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
      //console.log(newOrderRef)
      // Create ShipRocket order for COD
      try {
        const shipRocketToken = await getShipRocketToken();

        // Format address for ShipRocket
        const formatAddress = (address) => {
          return {
            name: address.name || customer?.customerName || 'Customer',
            address: address.address || address.line1 || '',
            address_2: address.address2 || address.line2 || '',
            city: address.city || '',
            state: address.state || '',
            country: address.country || 'India',
            pin_code: address.pinCode || address.zipCode || address.zip || address.postalCode || '',
            phone: address.phone || customer?.customerPhone || ''
          };
        };

        // Prepare ShipRocket order data
        const shipRocketOrderData = {
          order_id: orderData.orderId,
          order_date: new Date().toISOString().split('T')[0],
          pickup_location: "Home",

          // Billing Information
          billing_customer_name: customer?.customerName || 'Customer',
          billing_last_name: "",
          billing_address: billingAddress ? formatAddress(billingAddress).address : "123 Test Street",
          billing_address_2: billingAddress ? formatAddress(billingAddress).address_2 : "",
          billing_city: billingAddress?.city || "Mumbai",
          billing_pincode: billingAddress?.pinCode || billingAddress?.zipCode || billingAddress?.zip || "400001",
          billing_state: billingAddress?.state || "Maharashtra",
          billing_country: billingAddress?.country || "India",
          billing_phone: customer?.customerPhone || "9324554499",
          billing_email: customer?.customerEmail || "customer@example.com",

          // Shipping Information
          shipping_customer_name: customer?.customerName || 'Customer',
          shipping_last_name: "",
          shipping_address: formatAddress(shippingAddress).address || "123 Test Street",
          shipping_address_2: formatAddress(shippingAddress).address_2,
          shipping_city: shippingAddress?.city || "Mumbai",
          shipping_pincode: shippingAddress?.pinCode || shippingAddress?.zipCode || shippingAddress?.zip || "400001",
          shipping_state: shippingAddress?.state || "Maharashtra",
          shipping_country: shippingAddress?.country || "India",
          shipping_phone: customer?.customerPhone || "9324554499",
          shipping_email: customer?.customerEmail || "customer@example.com",

          // Order Items - validate and format
          order_items: orderItems.map((item, index) => ({
            name: item.productName || item.name || `Product ${index + 1}`,
            sku: item.productSku || item.sku || item.productId || `SKU-${Date.now()}-${index}`,
            units: item.quantity || item.units || 1,
            selling_price: item.unitPrice || item.price || item.selling_price || 100,
            discount: item.productDiscount || item.discount || 0,
            tax: item.productGst || item.tax || item.tax_amount || 0,
            hsn: item.productHsn || item.hsn || ""
          })),

          // Payment and charges
          payment_method: "COD",
          shipping_is_billing: true,
          shipping_charges: shippingCharges || 0,
          giftwrap_charges: 0,
          transaction_charges: 0,
          total_discount: discountAmount || 0,
          sub_total: cartTotal || totalAmount || orderItems.reduce((sum, item) => sum + ((item.unitPrice || item.price || 100) * (item.quantity || 1)), 0),

          // Package dimensions (using default values from shiprocketData or fallbacks)
          length: shiprocketData?.products?.[0]?.weight ? Math.max(shiprocketData.products[0].weight, 10) : 10,
          breadth: shiprocketData?.products?.[0]?.weight ? Math.max(shiprocketData.products[0].weight, 10) : 10,
          height: shiprocketData?.products?.[0]?.weight ? Math.max(shiprocketData.products[0].weight, 10) : 10,
          weight: shiprocketData?.products?.[0]?.weight || orderItems.reduce((sum, item) => sum + (item.productWeight || 0.5), 0) || 0.5
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

        console.log('ShipRocket Order Response:', shipRocketOrderResponse.data);

        // Update order with ShipRocket data
        await newOrderRef.update({
          shipRocketOrderId: shipRocketOrderResponse.data?.order_id,
          shipRocketShipmentId: shipRocketOrderResponse.data?.shipment_id,
          trackingNumber: shipRocketOrderResponse.data?.tracking_number || '',
          courierName: shipRocketOrderResponse.data?.courier_name || 'ShipRocket',
          shipRocketData: shipRocketOrderResponse.data || {}
        });

      } catch (shipRocketError) {
        console.error('Error creating ShipRocket order for COD:', shipRocketError);
        console.error('ShipRocket Error response:', shipRocketError.response?.data);
        // Continue with order creation even if ShipRocket integration fails
      }

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

      // Get the updated order data with ShipRocket info
      const updatedOrderDoc = await newOrderRef.get();
      const updatedOrderData = updatedOrderDoc.data();

      res.status(201).json({
        success: true,
        message: 'COD Order created successfully',
        orderId: orderData.orderId,
        shipRocketOrderId: updatedOrderData.shipRocketOrderId,
        trackingNumber: updatedOrderData.trackingNumber,
        courierName: updatedOrderData.courierName
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
        customerId: customer?.customerId,
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

      // Create ShipRocket order for Razorpay
      try {
        const shipRocketToken = await getShipRocketToken();

        // Format address for ShipRocket
        const formatAddress = (address) => {
          return {
            name: address.name || customer?.customerName || 'Customer',
            address: address.address || address.line1 || '',
            address_2: address.address2 || address.line2 || '',
            city: address.city || '',
            state: address.state || '',
            country: address.country || 'India',
            pin_code: address.pinCode || address.zipCode || address.zip || address.postalCode || '',
            phone: address.phone || customer?.customerPhone || ''
          };
        };

        // Prepare ShipRocket order data
        const shipRocketOrderData = {
          order_id: orderData.orderId,
          order_date: new Date().toISOString().split('T')[0],
          pickup_location: "Home",

          // Billing Information
          billing_customer_name: customer?.customerName || 'Customer',
          billing_last_name: "",
          billing_address: billingAddress ? formatAddress(billingAddress).address : "123 Test Street",
          billing_address_2: billingAddress ? formatAddress(billingAddress).address_2 : "",
          billing_city: billingAddress?.city || "Mumbai",
          billing_pincode: billingAddress?.pinCode || billingAddress?.zipCode || billingAddress?.zip || "400001",
          billing_state: billingAddress?.state || "Maharashtra",
          billing_country: billingAddress?.country || "India",
          billing_phone: customer?.customerPhone || "9324554499",
          billing_email: customer?.customerEmail || "customer@example.com",

          // Shipping Information
          shipping_customer_name: customer?.customerName || 'Customer',
          shipping_last_name: "",
          shipping_address: formatAddress(shippingAddress).address || "123 Test Street",
          shipping_address_2: formatAddress(shippingAddress).address_2,
          shipping_city: shippingAddress?.city || "Mumbai",
          shipping_pincode: shippingAddress?.pinCode || shippingAddress?.zipCode || shippingAddress?.zip || "400001",
          shipping_state: shippingAddress?.state || "Maharashtra",
          shipping_country: shippingAddress?.country || "India",
          shipping_phone: customer?.customerPhone || "9324554499",
          shipping_email: customer?.customerEmail || "customer@example.com",

          // Order Items - validate and format
          order_items: orderItems.map((item, index) => ({
            name: item.productName || item.name || `Product ${index + 1}`,
            sku: item.productSku || item.sku || item.productId || `SKU-${Date.now()}-${index}`,
            units: item.quantity || item.units || 1,
            selling_price: item.unitPrice || item.price || item.selling_price || 100,
            discount: item.productDiscount || item.discount || 0,
            tax: item.productGst || item.tax || item.tax_amount || 0,
            hsn: item.productHsn || item.hsn || ""
          })),

          // Payment and charges
          payment_method: "Prepaid",
          shipping_is_billing: true,
          shipping_charges: shippingCharges || 0,
          giftwrap_charges: 0,
          transaction_charges: 0,
          total_discount: discountAmount || 0,
          sub_total: cartTotal || totalAmount || orderItems.reduce((sum, item) => sum + ((item.unitPrice || item.price || 100) * (item.quantity || 1)), 0),

          // Package dimensions (using default values from shiprocketData or fallbacks)
          length: shiprocketData?.products?.[0]?.weight ? Math.max(shiprocketData.products[0].weight, 10) : 10,
          breadth: shiprocketData?.products?.[0]?.weight ? Math.max(shiprocketData.products[0].weight, 10) : 10,
          height: shiprocketData?.products?.[0]?.weight ? Math.max(shiprocketData.products[0].weight, 10) : 10,
          weight: shiprocketData?.products?.[0]?.weight || orderItems.reduce((sum, item) => sum + (item.productWeight || 0.5), 0) || 0.5
        };

        console.log('ShipRocket Order Data (Razorpay):', JSON.stringify(shipRocketOrderData, null, 2));

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

        console.log('ShipRocket Order Response (Razorpay):', shipRocketOrderResponse.data);

        // Update order with ShipRocket data
        await newOrderRef.update({
          shipRocketOrderId: shipRocketOrderResponse.data?.order_id,
          shipRocketShipmentId: shipRocketOrderResponse.data?.shipment_id,
          trackingNumber: shipRocketOrderResponse.data?.tracking_number || '',
          courierName: shipRocketOrderResponse.data?.courier_name || 'ShipRocket',
          shipRocketData: shipRocketOrderResponse.data || {}
        });

      } catch (shipRocketError) {
        console.error('Error creating ShipRocket order for Razorpay:', shipRocketError);
        console.error('ShipRocket Error response:', shipRocketError.response?.data);
        // Continue with order creation even if ShipRocket integration fails
      }

      // Get the updated order data with ShipRocket info
      const updatedOrderDoc = await newOrderRef.get();
      const updatedOrderData = updatedOrderDoc.data();

      res.status(201).json({
        success: true,
        message: 'Order created successfully',
        orderId: orderData.orderId,
        shipRocketOrderId: updatedOrderData.shipRocketOrderId,
        trackingNumber: updatedOrderData.trackingNumber,
        courierName: updatedOrderData.courierName
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
            paymentMethod: localOrderData.paymentMethod
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

      let customerData = null;
      if (order.customer_id) {
        try {
          const customerDoc = await db.collection('customers').doc(order.customer_id).get();

          if (customerDoc.exists) {
            const customer = customerDoc.data();
            console.log(customer);
            customerData = {
              email: customer.email || '',
              phone: customer.phone || '',
              contactName: customer.contactName,
              billing_address: customer.zohoData.billing_address || '',
              shipping_address: customer.zohoData.shipping_address || ''
            };
          }
        } catch (customerError) {
          console.error('Error fetching customer data:', customerError);
        }
      }

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
          paymentMethod: localOrderData.paymentMethod,
          customerData: customerData
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