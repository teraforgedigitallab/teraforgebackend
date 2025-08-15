const paymentController = require('../../controllers/paymentController');

module.exports = (req, res) => {
  return paymentController.initiateCashfreePayment(req, res);
};