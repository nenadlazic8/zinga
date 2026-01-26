# Deployment Guide - Zinga

Ovaj vodič objašnjava kako da objavite Zinga igricu online.

## Opcije za Deployment

### Opcija 1: Railway (Backend) + Vercel (Frontend) - PREPORUČENO

#### Backend (Railway)

1. **Kreiraj nalog na Railway:**
   - Idi na https://railway.app
   - Prijavi se sa GitHub nalogom

2. **Deploy backend:**
   - Klikni "New Project"
   - Izaberi "Deploy from GitHub repo"
   - Izaberi svoj repo
   - Railway će automatski detektovati Node.js projekat
   - **VAŽNO:** U "Settings" → "Root Directory" postavi: `server`
   - U "Variables" dodaj:
     ```
     PORT=3001
     CLIENT_ORIGIN=https://tvoj-frontend-url.vercel.app
     ```
   - Railway će automatski dodeliti URL (npr. `https://zinga-server.railway.app`)

#### Frontend (Vercel)

1. **Kreiraj nalog na Vercel:**
   - Idi na https://vercel.com
   - Prijavi se sa GitHub nalogom

2. **Deploy frontend:**
   - Klikni "Add New Project"
   - Izaberi svoj repo
   - U "Root Directory" postavi: `client`
   - U "Environment Variables" dodaj:
     ```
     VITE_SERVER_URL=https://tvoj-backend-url.railway.app
     ```
   - Klikni "Deploy"
   - Vercel će dati URL (npr. `https://zinga.vercel.app`)

3. **Ažuriraj backend CLIENT_ORIGIN:**
   - Vrati se u Railway
   - U "Variables" ažuriraj `CLIENT_ORIGIN` sa Vercel URL-om

---

### Opcija 2: Render (Backend + Frontend)

#### Backend

1. **Kreiraj nalog na Render:**
   - Idi na https://render.com
   - Prijavi se sa GitHub nalogom

2. **Deploy backend:**
   - Klikni "New" → "Web Service"
   - Poveži GitHub repo
   - Postavi:
     - **Name:** `zinga-server`
     - **Root Directory:** `server`
     - **Environment:** `Node`
     - **Build Command:** `npm install`
     - **Start Command:** `npm start`
   - Dodaj Environment Variables:
     ```
     PORT=3001
     CLIENT_ORIGIN=https://tvoj-frontend-url.onrender.com
     ```
   - Klikni "Create Web Service"

#### Frontend

1. **Deploy frontend:**
   - Klikni "New" → "Static Site"
   - Poveži GitHub repo
   - Postavi:
     - **Root Directory:** `client`
     - **Build Command:** `npm install && npm run build`
     - **Publish Directory:** `client/dist`
   - Dodaj Environment Variable:
     ```
     VITE_SERVER_URL=https://tvoj-backend-url.onrender.com
     ```
   - Klikni "Create Static Site"

---

## Lokalno testiranje pre deployment-a

1. **Build frontend:**
   ```bash
   cd client
   npm install
   npm run build
   ```

2. **Test server:**
   ```bash
   cd server
   npm install
   npm start
   ```

---

## Važne napomene

- **CORS:** Server mora imati tačan `CLIENT_ORIGIN` (sa `https://`)
- **Environment Variables:** Uvek koristi environment variables za URL-ove
- **Socket.io:** Proveri da li platforma podržava WebSocket konekcije (Railway i Render podržavaju)
- **HTTPS:** Oba servisa automatski daju HTTPS, što je potrebno za Socket.io

---

## Troubleshooting

### Problem: "Cannot connect to server"
- Proveri da li je `VITE_SERVER_URL` tačno postavljen u frontend environment variables
- Proveri da li je `CLIENT_ORIGIN` tačno postavljen u backend environment variables
- Proveri da li oba servisa rade (proveri logove)

### Problem: "CORS error"
- Proveri da li `CLIENT_ORIGIN` u backend-u odgovara tačnom frontend URL-u
- Uključi `https://` i bez trailing slash-a

### Problem: Socket.io ne radi
- Proveri da li platforma podržava WebSocket (Railway i Render podržavaju)
- Proveri da li koristiš HTTPS (ne HTTP)
