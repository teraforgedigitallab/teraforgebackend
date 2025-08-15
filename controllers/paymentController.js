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
exports.verifyCashfreePayment = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Missing orderId",
      });
    }

    console.log("🔍 Verifying payment for orderId:", orderId);
    
    // Fetch order details from Cashfree API
    const apiUrl = process.env.CASHFREE_ENVIRONMENT === "production" 
      ? "https://api.cashfree.com/pg/orders" 
      : "https://sandbox.cashfree.com/pg/orders";
      
    const headers = {
      "x-api-version": "2023-08-01",
      "x-client-id": process.env.CASHFREE_CLIENT_ID,
      "x-client-secret": process.env.CASHFREE_CLIENT_SECRET,
      "Content-Type": "application/json"
    };
    
    console.log(`📡 Calling Cashfree API at ${apiUrl}/${orderId}`);
    
    const response = await axios.get(`${apiUrl}/${orderId}`, { headers });
    
    // Log the response for debugging
    console.log("📄 Cashfree response:", JSON.stringify(response.data, null, 2));

    const orderStatus = response.data.order_status;
    console.log("🏷️ Cashfree order status:", orderStatus);

    // Simplified response data to avoid Firestore size limits
    const simplifiedResponseData = {
      order_id: response.data.order_id,
      order_amount: response.data.order_amount,
      order_status: response.data.order_status,
      order_currency: response.data.order_currency,
      order_note: response.data.order_note,
      payment_session_id: response.data.payment_session_id,
      created_at: response.data.created_at,
      updated_at: response.data.updated_at
    };

    // Fetch payment info from Firestore with error handling
    let docRef, doc, paymentInfo;
    try {
      docRef = db.collection("payments").doc(orderId);
      doc = await docRef.get();
      
      if (!doc.exists) {
        console.log("⚠️ Payment document not found in Firestore for orderId:", orderId);
        return res.status(404).json({
          success: false,
          status: "FAILED",
          message: "Payment record not found",
          data: simplifiedResponseData,
        });
      }

      paymentInfo = doc.data();
      console.log("📋 Current Firebase status:", paymentInfo.transactionInfo.status);
    } catch (dbError) {
      console.error("💥 Database error fetching document:", dbError);
      return res.status(500).json({
        success: false,
        status: "ERROR",
        message: "Database error: " + dbError.message,
        data: simplifiedResponseData,
      });
    }

    // Handle different payment statuses
    if (orderStatus === "PAID") {
      console.log("✅ Payment is PAID - updating status to COMPLETED");
      
      // Update Firestore status to COMPLETED using transaction for reliability
      try {
        // First attempt: direct update
        await docRef.update({
          "transactionInfo.status": "COMPLETED",
          "transactionInfo.updatedAt": new Date().toISOString(),
          "transactionInfo.paymentDetails": simplifiedResponseData
        });
        console.log("✓ Direct update to COMPLETED succeeded");
      } catch (updateError) {
        console.error("❌ Direct update failed:", updateError);
        
        // Second attempt: try with transaction
        try {
          await db.runTransaction(async (transaction) => {
            const docSnapshot = await transaction.get(docRef);
            if (!docSnapshot.exists) {
              throw new Error("Document does not exist!");
            }
            
            transaction.update(docRef, {
              "transactionInfo.status": "COMPLETED",
              "transactionInfo.updatedAt": new Date().toISOString(),
              "transactionInfo.paymentDetails": simplifiedResponseData
            });
          });
          console.log("✓ Transaction update to COMPLETED succeeded");
        } catch (transactionError) {
          console.error("❌ Transaction update failed:", transactionError);
          
          // Third attempt: create new document with complete data
          try {
            const completeData = paymentInfo;
            completeData.transactionInfo.status = "COMPLETED";
            completeData.transactionInfo.updatedAt = new Date().toISOString();
            completeData.transactionInfo.paymentDetails = simplifiedResponseData;
            
            await docRef.set(completeData);
            console.log("✓ Document replacement succeeded");
          } catch (setError) {
            console.error("❌ Document replacement failed:", setError);
            // At this point, we've tried everything - continue but note the error
          }
        }
      }
      
      // Send admin email if not already sent - don't let this block the response
      if (paymentInfo.transactionInfo.emailsSent !== true) {
        console.log("📧 Sending admin notification email...");
        
        // Send email in the background
        sendAdminNotificationEmail({
          customerName: paymentInfo.customerInfo.name,
          customerEmail: paymentInfo.customerInfo.email,
          customerPhone: paymentInfo.customerInfo.phone,
          amount: paymentInfo.transactionInfo.amount,
          currency: paymentInfo.transactionInfo.currency || "INR",
          plan: paymentInfo.planDetails.plan,
          duration: paymentInfo.planDetails.duration,
          merchantTransactionId: orderId,
        })
        .then(() => {
          console.log("📧 Admin notification email sent successfully");
          // Mark email as sent
          return docRef.update({
            "transactionInfo.emailsSent": true,
            "transactionInfo.emailSentAt": new Date().toISOString()
          });
        })
        .then(() => {
          console.log("✓ Email status updated in Firestore");
        })
        .catch(emailError => {
          console.error("❌ Error in email flow:", emailError);
        });
      }

      // Always return success for PAID status
      return res.json({
        success: true,
        status: "SUCCESS",
        message: "Payment successful",
        data: simplifiedResponseData,
      });
      
    } else if (orderStatus === "ACTIVE") {
      console.log("⏳ Payment is still ACTIVE/processing");
      
      // Try to update status to PROCESSING if it's still INITIATED
      if (paymentInfo.transactionInfo.status === "INITIATED") {
        try {
          await docRef.update({
            "transactionInfo.status": "PROCESSING",
            "transactionInfo.updatedAt": new Date().toISOString(),
            "transactionInfo.paymentDetails": simplifiedResponseData,
          });
          console.log("✓ Updated status to PROCESSING");
        } catch (updateError) {
          console.error("❌ Error updating to PROCESSING:", updateError);
        }
      }
      
      return res.json({
        success: false,
        status: "PENDING", 
        message: "Payment is still processing",
        data: simplifiedResponseData,
      });
      
    } else {
      console.log("❌ Payment failed or cancelled. Status:", orderStatus);
      
      // Update status to FAILED
      try {
        await docRef.update({
          "transactionInfo.status": "FAILED",
          "transactionInfo.updatedAt": new Date().toISOString(),
          "transactionInfo.paymentDetails": simplifiedResponseData,
          "transactionInfo.failureReason": `Cashfree status: ${orderStatus}`
        });
        console.log("✓ Updated status to FAILED");
      } catch (updateError) {
        console.error("❌ Error updating to FAILED:", updateError);
      }
      
      return res.json({
        success: false,
        status: "FAILED",
        message: `Payment failed or was cancelled. Status: ${orderStatus}`,
        data: simplifiedResponseData,
      });
    }
    
  } catch (error) {
    console.error("💥 Cashfree Verification Error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      status: "FAILED", 
      message: "Verification failed: " + (error.response?.data?.message || error.message),
      error: error.stack,
    });
  }
};

// Update the webhook handler too for maximum reliability
exports.cashfreeWebhook = async (req, res) => {
  try {
    const eventData = req.body;
    console.log("📥 Webhook data received:", JSON.stringify(eventData, null, 2));
    
    const orderId = eventData.data?.order?.order_id;
    const orderStatus = eventData.data?.order?.order_status;

    if (!orderId) {
      console.error("⚠️ Missing order_id in webhook data");
      return res.status(400).json({ success: false, message: "Missing order_id" });
    }

    console.log(`🔄 Processing webhook for order ${orderId} with status ${orderStatus}`);

    // Simplified event data to avoid Firestore size limits
    const simplifiedEventData = {
      event_time: eventData.event_time,
      type: eventData.type,
      order_id: eventData.data?.order?.order_id,
      order_status: eventData.data?.order?.order_status,
      order_amount: eventData.data?.order?.order_amount,
      order_currency: eventData.data?.order?.order_currency,
      created_at: eventData.data?.order?.created_at,
      updated_at: eventData.data?.order?.updated_at
    };

    // Handle the webhook with multiple fallback approaches
    try {
      // First, try to get the document
      const docRef = db.collection("payments").doc(orderId);
      const doc = await docRef.get();
      
      if (!doc.exists) {
        console.error(`⚠️ Document ${orderId} not found in Firestore`);
        return res.status(404).json({ success: false, message: "Payment record not found" });
      }
      
      const paymentInfo = doc.data();
      console.log("📋 Current payment status:", paymentInfo.transactionInfo.status);
      
      // First attempt: Direct update
      const newStatus = orderStatus === "PAID" ? "COMPLETED" : orderStatus;
      try {
        await docRef.update({
          "transactionInfo.status": newStatus,
          "transactionInfo.updatedAt": new Date().toISOString(),
          "transactionInfo.webhookData": simplifiedEventData,
          "transactionInfo.lastWebhookReceivedAt": new Date().toISOString()
        });
        console.log(`✓ Updated payment status to ${newStatus}`);
      } catch (updateError) {
        console.error("❌ Direct update failed:", updateError);
        
        // Second attempt: Try with transaction
        try {
          await db.runTransaction(async (transaction) => {
            const docSnapshot = await transaction.get(docRef);
            if (!docSnapshot.exists) {
              throw new Error("Document does not exist!");
            }
            
            transaction.update(docRef, {
              "transactionInfo.status": newStatus,
              "transactionInfo.updatedAt": new Date().toISOString(),
              "transactionInfo.webhookData": simplifiedEventData,
              "transactionInfo.lastWebhookReceivedAt": new Date().toISOString()
            });
          });
          console.log(`✓ Transaction update to ${newStatus} succeeded`);
        } catch (transactionError) {
          console.error("❌ Transaction update failed:", transactionError);
          
          // Third attempt: Try setting complete document
          try {
            const completeData = paymentInfo;
            completeData.transactionInfo.status = newStatus;
            completeData.transactionInfo.updatedAt = new Date().toISOString();
            completeData.transactionInfo.webhookData = simplifiedEventData;
            completeData.transactionInfo.lastWebhookReceivedAt = new Date().toISOString();
            
            await docRef.set(completeData);
            console.log("✓ Document replacement succeeded");
          } catch (setError) {
            console.error("❌ Document replacement failed:", setError);
            return res.status(500).json({ 
              success: false, 
              message: "All attempts to update payment record failed" 
            });
          }
        }
      }
      
      // If payment is successful, send admin notification email asynchronously
      if (orderStatus === "PAID" && paymentInfo.transactionInfo.emailsSent !== true) {
        // Don't await this - let it run in background
        sendAdminNotificationEmail({
          customerName: paymentInfo.customerInfo.name,
          customerEmail: paymentInfo.customerInfo.email,
          customerPhone: paymentInfo.customerInfo.phone,
          amount: paymentInfo.transactionInfo.amount,
          currency: paymentInfo.transactionInfo.currency || "INR",
          plan: paymentInfo.planDetails.plan,
          duration: paymentInfo.planDetails.duration,
          merchantTransactionId: orderId,
        })
        .then(() => {
          console.log("📧 Admin notification email sent from webhook");
          return docRef.update({
            "transactionInfo.emailsSent": true,
            "transactionInfo.emailSentAt": new Date().toISOString()
          });
        })
        .then(() => {
          console.log("✓ Email status updated in Firestore");
        })
        .catch(emailError => {
          console.error("❌ Email error in webhook:", emailError);
        });
      }
      
    } catch (dbError) {
      console.error("💥 Database error in webhook handler:", dbError);
      return res.status(500).json({ 
        success: false, 
        message: "Database error: " + dbError.message 
      });
    }

    // Always respond with success to Cashfree
    return res.status(200).json({ success: true, message: "Webhook processed successfully" });
  } catch (error) {
    console.error("💥 Cashfree Webhook Error:", error);
    return res.status(500).json({ success: false, message: "Webhook processing failed: " + error.message });
  }
};
