# Railway Fix - Build Configuration

## Problem
Railway ne vidi `server/package.json` jer pokušava da izvrši `cd server` pre nego što su fajlovi kopirani.

## Rešenje

### Opcija 1: Koristi Railway Build Command (PREPORUČENO)

U Railway Settings → Build & Deploy:

**Build Command:**
```bash
npm install && cd client && npm install && npm run build && cd ../server && npm install
```

**Start Command:**
```bash
cd server && npm start
```

---

### Opcija 2: Koristi nixpacks.toml

Kreiraj `nixpacks.toml` u root folderu:

```toml
[phases.setup]
nixPkgs = ["nodejs-18_x"]

[phases.install]
cmds = [
  "cd server && npm install",
  "cd ../client && npm install"
]

[phases.build]
cmds = [
  "cd client && npm run build"
]

[start]
cmd = "cd server && npm start"
```

---

### Opcija 3: Promeni strukturu (ako ništa ne radi)

Ako i dalje ne radi, možda treba da proveriš:
1. Da li su `server/` i `client/` folderi commit-ovani u Git
2. Da li Railway koristi tačan branch (`master` umesto `main`)

Proveri u Railway Settings → Source:
- **Branch:** `master` (ne `main`)
