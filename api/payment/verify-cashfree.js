const paymentController = require('../../controllers/paymentController');

module.exports = (req, res) => {
  return paymentController.verifyCashfreePayment(req, res);
};