# Railway Settings - Finalna Konfiguracija

## Podešavanja u Railway Dashboard

### 1. Source
- **Branch:** `main` ✅ (već je postavljeno)
- **Root Directory:** Ostavi **PRAZNO** ili postavi na `.` (root folder)

### 2. Build
- **Builder:** `Nixpacks` ✅ (automatski detektuje `nixpacks.toml`)
- **Build Command:** Ostavi **PRAZNO** (koristi `nixpacks.toml`)

### 3. Deploy
- **Start Command:** Ostavi **PRAZNO** (koristi `nixpacks.toml` start cmd)
  - Ili postavi: `cd server && npm start`

### 4. Networking
- **Public Domain:** `zinga-copy-production.up.railway.app` ✅

---

## Važno

- **NE postavljaj Root Directory na `server`** - mora biti root (`.` ili prazno)
- Railway će automatski koristiti `nixpacks.toml` za build proces
- Ako vidiš "The value is set in server/railway.json", to je greška - obriši taj fajl iz Git-a

---

## Ako Railway i dalje koristi server/railway.json

Obriši ga iz Git-a:
```bash
git rm server/railway.json
git commit -m "Remove server/railway.json"
git push origin main
```
