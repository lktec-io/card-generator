const express = require('express');
const router  = express.Router();

const { upload, generateInvitation } = require('../controllers/generateController');
const { verifyInvitation }           = require('../controllers/verifyController');
const { getDashboard }               = require('../controllers/adminController');

router.post('/generate',        upload.single('image'), generateInvitation);
router.post('/verify',          verifyInvitation);
router.get('/admin/dashboard',  getDashboard);

module.exports = router;
