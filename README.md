# CAD UX for Smartphone AR Project Setup (WebXR + HTTPS)

This project is a Three.js template using TypeScript and Vite, configured for WebXR development.

## Getting Started

[Examples to get started with XR](https://threejs.org/examples/?q=webxr)

### 1. Prerequisites
- **Node.js**: Ensure you have Node.js installed (v20.19.0+ or v22+ recommended).
- **Network**: Your VR headset and your computer must be on the **same Wi-Fi network**.

### 2. Installation
```bash
npm install
```

### 3. Running the project
```bash
npm run dev
```
The output will look like this:
```bash
VITE v5.x.x  ready in 400 ms

  ➜  Local:   https://localhost:5173/
  ➜  Network: [https://192.168.1.](https://192.168.1.)XX:5173/
```


## Connecting your Headset

Look for the Network URL in your terminal (e.g., https://192.168.1.25:5173).

Put on your VR headset and open the Browser (Oculus Browser, Wolvic, etc.).

Type the Network URL exactly as it appears (don't forget the s in https).

SSL Warning: Since we use a self-signed certificate, the browser will show a warning ("Your connection is not private").

    Click Advanced.

    Click Proceed to 192.168.1.XX (unsafe).

Click the "Enter VR" button at the bottom of the page.

## Use the emulator

Using chrome
Install the Immersive Web Emulator from meta:
[https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik](https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik)

Open your webpage and then open the developer tools (f12), Look for the WebXR tab at the top.

# Some examples models to use (don't commit them to the git)

[Bike](https://sketchfab.com/3d-models/bike-a4c57cc4d44f45a999e48d980a099aaf)

[Robot arm](https://sketchfab.com/3d-models/robot-arm-20781032ac0c4394af98e11b9d18ed9c)
