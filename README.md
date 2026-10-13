# Blackjack Strategy Trainer

Installable, offline-capable web app (Vite + React + PWA).

## Put it on your phone

1. Push this folder to a GitHub repo and import it in Vercel (it detects Vite on its own; no settings to change).
2. Open the Vercel URL on your phone, **while online**.
   - iPhone: Safari → Share → **Add to Home Screen**
   - Android: Chrome → menu → **Install app**
3. Open it once from the home screen icon and let it sit a few seconds so it finishes caching.
4. Before the flight, turn on airplane mode and open it from the icon to confirm it loads.

Stats and the heat map are saved on the phone (localStorage), so they persist offline.

## Run locally

```
npm install
npm run dev
```

## Swap the table textures

`public/textures/felt.jpg` and `public/textures/wood.jpg` are generated placeholders.
Drop in any photo textures with the same filenames and rebuild.
