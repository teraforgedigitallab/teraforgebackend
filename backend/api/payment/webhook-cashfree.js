const paymentController = require('../../controllers/paymentController');

module.exports = (req, res) => {
  return paymentController.cashfreeWebhook(req, res);
};