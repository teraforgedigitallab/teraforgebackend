const axios = require("axios");
const { Cashfree, CFEnvironment } = require("cashfree-pg");
const nodemailer = require("nodemailer");
const admin = require("../utils/firebase");

// Get Firestore instance
const db = admin.firestore();

// Configure nodemailer transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_SECURE === "true",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Function to send notification email to admin
const sendAdminNotificationEmail = async (paymentDetails) => {
  try {
    const {
      customerName,
      customerEmail,
      customerPhone,
      amount,
      plan,
      duration,
      merchantTransactionId,
      currency = "INR"
    } = paymentDetails;

    const subject = `New Client Alert: ${customerName} has made a payment!`;

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #4a6ee0;">🎉 Great news! You have a new client!</h2>
        <p>A customer has just completed a payment on <b>Teraforge Digital Lab LLP</b>.</p>
        <h3 style="margin-top: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px;">Client Details:</h3>
        <ul style="list-style-type: none; padding-left: 0;">
          <li><strong>Name:</strong> ${customerName}</li>
          <li><strong>Email:</strong> ${customerEmail}</li>
          <li><strong>Phone:</strong> ${customerPhone || "Not provided"}</li>
          <li><strong>Transaction ID:</strong> ${merchantTransactionId}</li>
        </ul>
        <h3 style="margin-top: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px;">Purchase Details:</h3>
        <ul style="list-style-type: none; padding-left: 0;">
          <li><strong>Amount Paid:</strong> ${currency} ${amount}</li>
          <li><strong>Plan:</strong> ${plan || "Custom package"}</li>
          <li><strong>Duration:</strong> ${duration} Month(s)</li>
        </ul>
        <div style="margin-top: 30px; padding: 15px; background-color: #f7f7f7; border-radius: 5px;">
          <p style="margin-top: 0;"><strong>Next Steps:</strong></p>
          <ol>
            <li>Reach out to the client within 24 hours to welcome them</li>
            <li>Set up their account with the purchased packages</li>
            <li>Schedule an onboarding call if needed</li>
          </ol>
        </div>
        <p style="margin-top: 30px; font-size: 12px; color: #777;">
          This is an automated message from Teraforge Digital Lab platform. Please do not reply directly to this email.
        </p>
      </div>
    `;

    await transporter.sendMail({
      from: `"Teraforge Digital Lab LLP Notifications" <${process.env.EMAIL_FROM}>`,
      to: process.env.ADMIN_EMAIL,
      subject,
      html,
    });

    console.log(`Admin notification email sent for customer: ${customerName}`);
    return true;
  } catch (error) {
    console.error("Error sending admin notification email:", error);
    return false;
  }
};

// Store payment data in Firestore
const storePaymentData = async (paymentData) => {
  try {
    const timestamp = new Date();
    const paymentDoc = {
      customerInfo: {
        name: paymentData.customerName || "",
        email: paymentData.customerEmail || "",
        phone: paymentData.customerPhone || "",
      },
      transactionInfo: {
        id: paymentData.merchantTransactionId || "",
        amount: paymentData.amount || 0,
        currency: paymentData.currency || "INR",
        status: paymentData.status || "UNKNOWN",
        paymentMethod: "cashfree",
        createdAt: paymentData.createdAt || timestamp.toISOString(),
        updatedAt: paymentData.updatedAt || timestamp.toISOString(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      },
      planDetails: {
        plan: paymentData.plan || "",
        duration: paymentData.duration || "",
      },
    };

    await db
      .collection("payments")
      .doc(paymentData.merchantTransactionId)
      .set(paymentDoc);
    console.log(
      "Payment data stored in Firestore with ID:",
      paymentData.merchantTransactionId
    );
    return paymentData.merchantTransactionId;
  } catch (error) {
    console.error("Error storing payment data in Firestore:", error);
    return null;
  }
};

// Initialize Cashfree client based on environment
const getCashfreeClient = () => {
  const environment =
    process.env.CASHFREE_ENVIRONMENT === "production"
      ? CFEnvironment.PRODUCTION
      : CFEnvironment.SANDBOX;

  return new Cashfree(
    environment,
    process.env.CASHFREE_CLIENT_ID,
    process.env.CASHFREE_CLIENT_SECRET
  );
};

// Initiate Cashfree Payment
exports.initiateCashfreePayment = async (req, res) => {
  try {
    const {
      amount,
      plan,
      duration,
      customerName,
      customerEmail,
      customerPhone,
      currency = "INR",
      returnUrl,
    } = req.body;

    if (!amount || !customerEmail || !customerName || !customerPhone) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: amount, customerName, customerEmail, customerPhone",
      });
    }

    // Validate phone number
    const validatedPhone =
      customerPhone && customerPhone.length >= 10
        ? customerPhone
        : "9999999999";

    // Generate unique transaction ID
    const merchantTransactionId = `HFU_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 6)
      .toUpperCase()}`;

    // Create return URL
    const finalReturnUrl = `${returnUrl || process.env.FRONTEND_URL + "/payment-status"}?order_id=${merchantTransactionId}`;

    // Prepare order request
    const orderRequest = {
      order_id: merchantTransactionId,
      order_amount: amount.toString(),
      order_currency: currency,
      customer_details: {
        customer_id: `CUST_${Date.now()}`,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: validatedPhone,
      },
      order_meta: {
        return_url: finalReturnUrl,
        notify_url: process.env.BACKEND_URL + "/api/payment/webhook-cashfree",
      },
      order_note: `Teraforge - ${plan || "Hosting"} Plan for ${duration || "12"} Month(s)`,
    };

    // Create order in Cashfree
    const cashfree = getCashfreeClient();
    const response = await cashfree.PGCreateOrder(orderRequest);

    if (response.data && response.data.payment_session_id) {
      // Store payment info in Firestore
      const paymentInfo = {
        merchantTransactionId,
        amount: parseFloat(amount),
        currency,
        customerName,
        customerEmail,
        customerPhone: validatedPhone,
        plan,
        duration,
        status: "INITIATED",
        createdAt: new Date().toISOString(),
        paymentMethod: "cashfree",
        cashfreeOrderId: response.data.order_id,
        paymentSessionId: response.data.payment_session_id,
      };
      await storePaymentData(paymentInfo);

      return res.json({
        success: true,
        order_id: response.data.order_id,
        payment_session_id: response.data.payment_session_id,
        merchantTransactionId,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Payment initiation failed",
        error: response.data,
      });
    }
  } catch (error) {
    console.error(
      "Cashfree Payment Error:",
      error.response?.data || error.message
    );
    return res.status(500).json({
      success: false,
      message:
        "Payment initiation failed: " +
        (error.response?.data?.message || error.message),
    });
  }
};

// Verify Cashfree Payment
// Update the verifyCashfreePayment function

exports.verifyCashfreePayment = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Missing orderId",
        status: "FAILED"
      });
    }

    console.log("Verifying payment for orderId:", orderId);
    
    // Fetch order details from Cashfree
    const apiUrl = process.env.CASHFREE_ENVIRONMENT === "production" 
      ? "https://api.cashfree.com/pg/orders" 
      : "https://sandbox.cashfree.com/pg/orders";
      
    const headers = {
      "x-api-version": "2022-09-01",
      "x-client-id": process.env.CASHFREE_CLIENT_ID,
      "x-client-secret": process.env.CASHFREE_CLIENT_SECRET,
      "Content-Type": "application/json"
    };
    
    console.log(`Calling Cashfree API at ${apiUrl}/${orderId}`);
    
    const response = await axios.get(`${apiUrl}/${orderId}`, { headers });
    
    // Log the full response for debugging
    console.log("Cashfree verification response:", JSON.stringify(response.data, null, 2));

    // IMPORTANT: Return the exact data from Cashfree without modification
    return res.json({
      success: response.data.order_status === "PAID",
      data: response.data
    });
  } catch (error) {
    console.error("Cashfree Verification Error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      status: "FAILED",
      message: "Verification failed due to a server error",
      error: error.message
    });
  }
};

// Cashfree Webhook Handler
exports.cashfreeWebhook = async (req, res) => {
  try {
    const eventData = req.body;
    const orderId = eventData.data?.order?.order_id;
    const orderStatus = eventData.data?.order?.order_status;

    if (orderId) {
      // Update Firestore status
      const docRef = db.collection("payments").doc(orderId);
      const doc = await docRef.get();

      if (doc.exists) {
        await docRef.update({
          "transactionInfo.status":
            orderStatus === "PAID" ? "COMPLETED" : orderStatus,
          "transactionInfo.updatedAt": new Date().toISOString(),
          webhookData: eventData,
        });

        // If payment is successful, send notification
        if (orderStatus === "PAID") {
          const paymentInfo = doc.data();

          await sendAdminNotificationEmail({
            customerName: paymentInfo.customerInfo.name,
            customerEmail: paymentInfo.customerInfo.email,
            customerPhone: paymentInfo.customerInfo.phone,
            amount: paymentInfo.transactionInfo.amount,
            currency: paymentInfo.transactionInfo.currency,
            plan: paymentInfo.planDetails.plan,
            duration: paymentInfo.planDetails.duration,
            merchantTransactionId: orderId,
          });
        }
      }
    }

    res.status(200).json({ success: true, message: "Webhook processed" });
  } catch (error) {
    console.error("Cashfree Webhook Error:", error);
    res.status(500).json({ success: false, message: "Webhook failed" });
  }
};

