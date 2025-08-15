require('dotenv').config();
const express = require('express');
const cors = require('cors');
const paymentController = require('../controllers/paymentController');

// Create server handler for Vercel
const app = express();

// Configure CORS for all origins since this is a public API
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON requests
app.use(express.json());

// Health check endpoint
app.get('/api', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'API is running' });
});

// Payment routes
app.post('/api/payment/initiate-cashfree', paymentController.initiateCashfreePayment);
app.post('/api/payment/verify-cashfree', paymentController.verifyCashfreePayment);
app.post('/api/payment/webhook-cashfree', paymentController.cashfreeWebhook);

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Export for Vercel
module.exports = app;