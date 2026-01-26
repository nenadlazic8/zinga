// DODAJ OVE IZMENE U server/src/index.js

// 1. Na vrhu fajla, dodaj ove import-e (posle postojećih):
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 2. Posle linije: app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
// DODAJ:
app.use(express.static(join(__dirname, '../../client/dist')));

// 3. PRE server.listen(PORT, ...) linije, DODAJ:
// Serve React app for all non-API routes
app.get('*', (req, res, next) => {
  // Skip API and Socket.io routes
  if (req.path.startsWith('/health') || req.path.startsWith('/socket.io')) {
    return next();
  }
  res.sendFile(join(__dirname, '../../client/dist/index.html'), (err) => {
    if (err) {
      // If client/dist doesn't exist, continue (backend-only mode)
      next();
    }
  });
});

// 4. Ako vidiš helmet() u kodu, zameni ga sa:
// (ako ne koristiš helmet, preskoči ovaj korak)
/*
import helmet from "helmet";

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "data:", "blob:"],
        "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        "connect-src": [
          "'self'",
          "wss://zinga-copy-production.up.railway.app",
          "https://zinga-copy-production.up.railway.app"
        ],
        "frame-ancestors": ["'none'"]
      },
    },
  })
);
*/
