# Izmene za Server (Railway Deployment)

Dodaj ove izmene u `server/src/index.js`:

## 1. Dodaj import za `path` i `url` na vrh fajla:

```javascript
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeTeamScore, createDeck, shuffleInPlace, teamForSeat } from "./game.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

## 2. Dodaj serviranje statičkih fajlova PRE `server.listen`:

Pronađi liniju `server.listen(PORT, ...)` i PRE nje dodaj:

```javascript
// Serve static files from client/dist (if it exists)
const clientDistPath = join(__dirname, '../../client/dist');
app.use(express.static(clientDistPath));

// For all non-API routes, send index.html (SPA routing)
app.get('*', (req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/health') || req.path.startsWith('/socket.io')) {
    return next();
  }
  res.sendFile(join(clientDistPath, 'index.html'), (err) => {
    if (err) {
      // If client/dist doesn't exist, just continue (backend-only mode)
      next();
    }
  });
});
```

## 3. Ako koristiš helmet (za CSP), dodaj ovu konfiguraciju:

Ako vidiš `app.use(helmet())` u kodu, zameni ga sa:

```javascript
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
```

**NAPOMENA:** Ako ne koristiš helmet, ovo možeš preskočiti.

---

## Alternativno: Build frontend u server folder

Ako želiš da build-uješ frontend direktno u server folder:

1. U `server/package.json` dodaj build script:
```json
"scripts": {
  "build": "cd ../client && npm install && npm run build && cp -r dist ../server/client-dist",
  "start": "node src/index.js"
}
```

2. U `server/src/index.js` promeni putanju:
```javascript
const clientDistPath = join(__dirname, '../client-dist');
```

---

## Važno za Railway

- Railway automatski build-uje projekat
- Možeš dodati build command u Railway Settings:
  - Build Command: `cd client && npm install && npm run build`
  - Start Command: `cd server && npm start`
