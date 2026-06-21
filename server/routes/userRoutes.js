const express = require('express');
const router  = express.Router();

const { requireAdmin, requireManager } = require('../middleware/authMiddleware');
const {
  listUsers, listForDropdown, createUser, getUser, updateUser, toggleStatus, deleteUser,
} = require('../controllers/userController');

// /dropdown must be before /:id so Express matches it correctly
router.get(   '/dropdown',   requireManager, listForDropdown);
router.get(   '/',           requireAdmin,   listUsers);
router.post(  '/',           requireAdmin,   createUser);
router.get(   '/:id',        requireAdmin,   getUser);
router.put(   '/:id',        requireAdmin,   updateUser);
router.patch( '/:id/status', requireAdmin,   toggleStatus);
router.delete('/:id',        requireAdmin,   deleteUser);

module.exports = router;
