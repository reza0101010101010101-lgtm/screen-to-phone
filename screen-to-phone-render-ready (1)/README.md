# Screen → Phone (WebRTC)

This starter project shares a Windows browser tab/screen with system audio to a second phone browser.

## Important
- Browser screen capture and system-audio capture require HTTPS (or localhost).
- Chrome/Edge on Windows can offer "Share system audio" when the selected capture source supports it.
- This package uses a small WebSocket signaling server. It is NOT a public relay; WebRTC attempts a direct connection.
- For internet use, deploy the server over WSS/HTTPS and serve the frontend over HTTPS.

## Run locally
1. Install Node.js 18+.
2. In this folder:
   `npm install`
3. Start:
   `npm start`
4. On the PC open `http://localhost:3000`
5. On the phone, localhost will NOT work. For a LAN test, use your PC's LAN IP after starting the server (e.g. `http://192.168.1.10:3000`), but camera/screen capture and secure browser policies are best tested with HTTPS.

## Flow
PC clicks "Start sharing" → gets a room code → phone opens the same URL with `?room=CODE` → phone receives video/audio.

For a public link, deploy the Node app on a host that supports WebSockets and HTTPS.
