# Screen → Phone — Internet deployment

Prepared for Render free Web Service. The app uses Express + WebSocket signaling and WebRTC for the screen/audio stream.

## Render settings
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Plan: Free
- Health Check Path: `/health`

Render provides a public HTTPS `onrender.com` URL and supports inbound WebSocket connections. The phone must use the HTTPS URL, not localhost.

## Use
1. Deploy this repository to Render.
2. Open the resulting HTTPS URL on the PC.
3. Click Start sharing and enable Share system audio when offered.
4. Send the generated phone link to the remote viewer.

Free Render services can sleep after 15 minutes of inactivity and may take about a minute to wake. WebRTC is peer-to-peer; the server is used for signaling. Some restrictive networks may require a TURN server for reliable connectivity.
