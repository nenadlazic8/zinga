# Zinga - Online Multiplayer Card Game

Full-stack multiplayer online kartaška igra **Zinga** (2v2) sa:

- **Frontend**: React + Tailwind CSS (Vite)
- **Backend**: Node.js + Express + Socket.io (real-time stanje sobe/igre)

> Potrebno: **Node.js 18+** (zbog `randomUUID()`).

## 🚀 Objavi online

Za detaljne instrukcije, pogledaj **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

**Brzi start:**
1. **Backend:** Deploy na [Railway](https://railway.app) ili [Render](https://render.com)
2. **Frontend:** Deploy na [Vercel](https://vercel.com) ili [Netlify](https://netlify.com)
3. Postavi environment variables (vidi `DEPLOYMENT.md`)

## Pokretanje (lokalno)

### 1) Server

U jednom terminalu:

```bash
cd server
npm install
npm run dev
```

Server startuje na `http://localhost:3001`.

### 2) Klijent

U drugom terminalu:

```bash
cd client
npm install
npm run dev
```

Klijent startuje na `http://localhost:5173`.

## Igranje

1. Otvorite **4 taba** ili 4 browser prozora na `http://localhost:5173`.
2. Svako unese svoje ime i isti **ID sobe** (npr. `ZINGA`).
3. Igra automatski počinje kada se povežu 4 igrača.

## Pravila (implementirano u engine-u)

- **Timovi**: Tim A (mesta 1 i 3), Tim B (mesta 2 i 4)
- **Deljenje**: prva runda 4 karte svakome + 4 karte na sto; zatim po 4 karte dok se špil ne isprazni
- **Potezi**: igra se u smeru kazaljke na satu (0 → 1 → 2 → 3)
- **Uzimanje (osnovno)**: nosi se samo ako odigrana karta ima isti **rang** kao **poslednja (gornja) karta** na talonu → igrač uzima **ceo talon** + odigranu kartu
- **Žandar (J)**: uzima ceo sto (ako sto nije prazan); ako je sto prazan, Žandar ostaje na stolu
- **Zinga (Šiba)**: ako je na talonu tačno 1 karta i uzmete je (poklapanje sa poslednjom) → **+10**
- **Zinga na Žandara**: ako Žandar uzme talon koji ima tačno 1 kartu → **+20**
- **Meč**: igra se do **101** ukupnih poena (više ruku sa novim špilom)
- **Last take**: poslednji igrač koji je uzimao dobija preostale karte sa stola na kraju

## Napomene

- Logika “sumiranja” (Tablić varijanta) nije implementirana — trenutno je **samo rang meč**.
- Stanje soba je u memoriji servera (bez baze). Restart servera briše sobe.

