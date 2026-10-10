// Kept exactly as before: .env is resolved from the working directory. Changing
// which file loads could swap production's configuration underneath it, so the
// startup report below says which file was used instead.
const envResult    = require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const inviteRoutes = require('./routes/invitationRoutes');
const authRoutes   = require('./routes/authRoutes');
const userRoutes   = require('./routes/userRoutes');
const errorHandler = require('./middleware/errorHandler');

// Async handler failures go to errorHandler instead of crashing the process
// (Express 4 + Node 22: an unhandled rejection terminates it). See the module.
require('./middleware/asyncErrors').install();

// Last line of defence: log, never exit. Exiting would drop every in-flight
// request and in-memory job (bulk SMS, WhatsApp campaigns, card generation).
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason?.code || '', reason?.message || reason);
});

// Trigger connection test on startup
require('./config/db');

const app  = express();
const PORT = process.env.PORT || 8003;

// ── Middleware ────────────────────────────────────────────────────────────────
// First, so body parsing and every route are inside the timed request context.
app.use(require('./middleware/requestTiming'));
app.use(cors({
  origin:      process.env.CLIENT_URL || 'https://wedding.nardio.online',
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve locally generated card images at /generated/*
app.use('/generated', express.static(path.join(__dirname, 'generated')));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',  authRoutes);
app.use('/users', userRoutes);
app.use('/',      inviteRoutes);

// Root health check (also handles stray GET / if Nginx config changes)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Error handler (must be last) ──────────────────────────────────────────────
app.use(errorHandler);

// Bring the database up to the schema this code expects, using the app's own connection.
// Add-only and idempotent. If it cannot run, the API still starts and the reason is logged,
// so a schema problem can never silently take the whole site down.
const { ensureSchema } = require('./database/ensureSchema');

ensureSchema()
  .catch((err) => console.error('[schema] check failed:', err.message))
  .finally(() => {
    app.listen(PORT, () => {
      // Replaces a hardcoded "https://wedding.nardio.online${PORT}" — a log line
      // only (nothing read it), but wrong twice: the ':' was missing, and this
      // process serves plain HTTP behind nginx, never https on this port.
      require('./config/startupCheck').startupReport({ port: PORT, envResult });
    });
  });
