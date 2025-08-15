require('dotenv').config();
const express = require('express');
const cors = require('cors');
const paymentController = require('../controllers/paymentController');

const app = express();

// Fix CORS configuration to allow requests from your main domain
app.use(cors({
  origin: ['https://teraforgedigitallab.com', 'https://www.teraforgedigitallab.com', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Parse JSON bodies
app.use(express.json());

// API routes
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

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export for Vercel
module.exports = app;
