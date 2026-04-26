require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const inviteRoutes = require('./routes/invitationRoutes');
const errorHandler = require('./middleware/errorHandler');

// Trigger connection test on startup
require('./config/db');

const app  = express();
const PORT = process.env.PORT || 8003;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin:      process.env.CLIENT_URL || 'https://wedding.nardio.online/',
  credentials: true,
  methods:     ['GET', 'POST'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve locally generated card images at /generated/*
app.use('/generated', express.static(path.join(__dirname, 'generated')));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', inviteRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Error handler (must be last) ──────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n💍 Wedding QR Server  →  https://wedding.nardio.online:${PORT}\n`);
});
