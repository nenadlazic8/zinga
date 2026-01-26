# Railway Setup - Zinga

## Build Configuration

### Opcija 1: Build frontend pre servera

U Railway Settings:
- **Root Directory:** `.` (root projekta)
- **Build Command:** 
  ```bash
  cd client && npm install && npm run build && cd ../server && npm install
  ```
- **Start Command:** 
  ```bash
  cd server && npm start
  ```

### Opcija 2: Build frontend u server folder

1. Dodaj u `server/package.json`:
```json
{
  "scripts": {
    "build": "cd ../client && npm install && npm run build",
    "start": "node src/index.js",
    "postinstall": "npm run build"
  }
}
```

2. U Railway Settings:
- **Root Directory:** `server`
- **Build Command:** `npm install` (automatski će pokrenuti postinstall)
- **Start Command:** `npm start`

3. U `server/src/index.js` promeni putanju:
```javascript
const clientDistPath = join(__dirname, '../client-dist');
// ili
const clientDistPath = join(__dirname, '../../client/dist');
```

---

## Environment Variables u Railway

Dodaj ove varijable u Railway Settings → Variables:

```
PORT=3001
CLIENT_ORIGIN=https://zinga-copy-production.up.railway.app
```

**VAŽNO:** `CLIENT_ORIGIN` treba da bude tvoj Railway URL (ili Vercel URL ako koristiš Vercel za frontend).

---

## Ako koristiš Vercel za frontend (preporučeno)

Ako frontend hostuješ na Vercel-u, onda:
- Railway servira samo backend (API + Socket.io)
- Vercel servira frontend
- `CLIENT_ORIGIN` u Railway = Vercel URL
- `VITE_SERVER_URL` u Vercel = Railway URL

U tom slučaju, **ne treba** da serviraš statičke fajlove iz servera - možeš obrisati te linije iz `server/src/index.js`.
