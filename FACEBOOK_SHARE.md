# Objavljivanje Zinga igrice na Facebooku

## Šta je potrebno:

### 1. **Validna URL adresa**
Tvoja igrica je već deploy-ovana na Railway:
- URL: `https://zinga-copy-production.up.railway.app/`
- Proveri da li radi i da li je dostupna javno

### 2. **Open Graph meta tagovi** ✅
Dodati su u `client/index.html`:
- `og:title` - Naslov
- `og:description` - Opis
- `og:image` - Slika za preview (potrebno je kreirati)
- `og:url` - URL igrice

### 3. **OG Image (Slika za preview)** ⚠️ **POTREBNO**
Facebook zahteva sliku za preview kada se link deli. 

**Specifikacije:**
- Dimenzije: **1200x630px** (preporučeno)
- Format: PNG ili JPG
- Maksimalna veličina: 8MB
- Naziv fajla: `og-image.png` ili `og-image.jpg`

**Gde da staviš:**
- Kopiraj sliku u `client/public/og-image.png` (ili kreiraj `public` folder ako ne postoji)
- Ili stavi u `client/src/assets/` i ažuriraj putanju u `index.html`

**Šta da staviš na sliku:**
- Logo/naslov "Zinga"
- Kratak opis: "Online Kartaska Igra 2v2"
- Možda screenshot igrice ili karte

### 4. **Testiranje Facebook Share**
Koristi Facebook Sharing Debugger:
- Idi na: https://developers.facebook.com/tools/debug/
- Unesi URL: `https://zinga-copy-production.up.railway.app/`
- Klikni "Scrape Again" da osvežiš cache
- Proveri preview kako će izgledati na Facebooku

### 5. **Opcija: Facebook Share Button** (opcionalno)
Možeš dodati dugme za deljenje direktno u igricu:

```jsx
// U App.jsx, dodaj funkciju:
function shareOnFacebook() {
  const url = encodeURIComponent(window.location.href);
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank');
}

// Dodaj dugme gde želiš:
<button onClick={shareOnFacebook}>
  Podeli na Facebooku
</button>
```

## Koraci za objavljivanje:

1. **Kreiraj OG Image** (1200x630px)
   - Možeš koristiti Canva, Photoshop, ili bilo koji editor
   - Dodaj logo, naslov, i kratak opis

2. **Dodaj sliku u projekat**
   ```bash
   # Kreiraj public folder ako ne postoji
   mkdir client/public
   # Kopiraj sliku
   cp path/to/your/image.png client/public/og-image.png
   ```

3. **Ažuriraj URL u index.html** (ako je potrebno)
   - Proveri da li je `og:url` tačan
   - Proveri da li je `og:image` putanja tačna

4. **Deploy na Railway**
   ```bash
   git add .
   git commit -m "Add Facebook Open Graph meta tags"
   git push origin main
   ```

5. **Testiraj sa Facebook Debugger**
   - https://developers.facebook.com/tools/debug/
   - Unesi URL i proveri preview

6. **Objavi na Facebooku**
   - Kada je sve spremno, možeš jednostavno da podeliš link
   - Facebook će automatski učitati preview sa slikom i opisom

## Napomene:

- **Cache:** Facebook cache-uje meta tagove. Ako menjaš nešto, koristi Debugger da osvežiš cache
- **HTTPS:** Facebook zahteva HTTPS (Railway automatski daje HTTPS)
- **Validacija:** Proveri da li su svi meta tagovi validni koristeći Facebook Debugger

## Dodatne opcije (opcionalno):

- **Facebook App ID:** Ako želiš analitiku i napredne funkcionalnosti
- **Facebook Pixel:** Za praćenje konverzija
- **Facebook Comments:** Da omogućiš komentare na linku
