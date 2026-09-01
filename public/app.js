const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const roomFromUrl = normalizeRoom(params.get("room"));
const sessionKey = "screen-to-phone-session";
const sessionId =
  sessionStorage.getItem(sessionKey) ||
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
sessionStorage.setItem(sessionKey, sessionId);

let ws = null;
let pc = null;
let localStream = null;
let currentRoom = "";
let currentRole = "";
let reconnectTimer = null;
let reconnectAttempt = 0;
let manualStop = false;
let pendingIceCandidates = [];
let addedTracks = false;
let offerInProgress = false;

const TURN_URL = ""; // Optional: set via server-injected config if you add one later.
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" }
  ]
};

function normalizeRoom(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

function makeRoomCode() {
  // Avoid ambiguous characters such as 0/O and 1/I.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}

function setStatus(text) {
  const target = currentRole === "viewer" ? $("vstatus") : $("status");
  if (target) target.textContent = text;
}

function setNotice(id, text, show = true) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.hidden = !show;
}

function setBadge(text, kind = "") {
  const badge = $("connectionBadge");
  if (!badge) return;
  badge.textContent = text;
  badge.className = `badge ${kind}`.trim();
}

function wsUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}`;
}

function send(message) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

function connectSignaling() {
  clearTimeout(reconnectTimer);

  if (ws && ws.readyState !== WebSocket.CLOSED) {
    try { ws.close(); } catch {}
  }

  const socket = new WebSocket(wsUrl());
  ws = socket;

  socket.addEventListener("open", () => {
    reconnectAttempt = 0;
    send({
      type: "join",
      room: currentRoom,
      role: currentRole,
      sessionId
    });

    setStatus(
      currentRole === "host"
        ? "به سرور متصل شدیم؛ منتظر گوشی هستیم…"
        : "به اتاق وصل شدیم؛ منتظر کامپیوتر هستیم…"
    );
  });

  socket.addEventListener("message", async (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    try {
      await handleSignal(message);
    } catch (error) {
      console.error("Signaling/WebRTC error:", error);
      showWebRtcError(error);
    }
  });

  socket.addEventListener("close", () => {
    if (ws !== socket) return;

    if (!manualStop) {
      setStatus("ارتباط signaling قطع شد؛ تلاش برای اتصال مجدد…");
      if (currentRole === "viewer") setBadge("قطع شد", "bad");
      scheduleReconnect();
    }
  });

  socket.addEventListener("error", () => {
    if (currentRole === "viewer") {
      setStatus("خطا در اتصال به سرور؛ در حال تلاش مجدد…");
    }
  });
}

function scheduleReconnect() {
  if (manualStop || reconnectTimer) return;

  reconnectAttempt += 1;
  const delay = Math.min(1000 * 2 ** Math.min(reconnectAttempt - 1, 5), 15000);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectSignaling();
  }, delay);
}

async function handleSignal(message) {
  switch (message.type) {
    case "joined":
      if (currentRole === "host") {
        setStatus(
          message.peerConnected
            ? "گوشی متصل است؛ در حال آماده‌سازی WebRTC…"
            : "اتاق ساخته شد؛ لینک را برای گوشی بفرستید."
        );

        if (message.peerConnected && localStream) {
          await createOffer();
        }
      } else {
        setStatus(
          message.peerConnected
            ? "کامپیوتر متصل است؛ منتظر دریافت تصویر…"
            : "منتظر اتصال کامپیوتر هستیم…"
        );
        setBadge("منتظر اتصال");
      }
      break;

    case "peer-joined":
    case "viewer-ready":
    case "request-offer":
      if (currentRole === "host" && localStream) {
        await createOffer();
      } else if (currentRole === "viewer") {
        setStatus("کامپیوتر متصل شد؛ منتظر تصویر…");
      }
      break;

    case "offer":
      if (currentRole === "viewer") {
        await acceptOffer(message.offer);
      }
      break;

    case "answer":
      if (currentRole === "host" && pc) {
        await pc.setRemoteDescription(message.answer);
        await flushPendingIce();
      }
      break;

    case "ice":
      if (message.candidate) {
        if (pc?.remoteDescription) {
          try {
            await pc.addIceCandidate(message.candidate);
          } catch (error) {
            console.warn("ICE candidate rejected:", error);
          }
        } else {
          pendingIceCandidates.push(message.candidate);
        }
      }
      break;

    case "peer-left":
      await resetPeerConnection();
      if (currentRole === "host") {
        setStatus("گوشی قطع شد؛ لینک اتاق همچنان فعال است.");
      } else {
        setStatus("کامپیوتر قطع شد؛ منتظر اتصال مجدد هستیم…");
        setBadge("منتظر اتصال", "bad");
        showViewerPlaceholder(true);
      }
      break;

    case "peer-rejoined":
      if (currentRole === "host" && localStream) {
        await createOffer();
      }
      break;

    case "stop-sharing":
      if (currentRole === "viewer") {
        await resetPeerConnection();
        setStatus("اشتراک‌گذاری از طرف کامپیوتر متوقف شد.");
        setBadge("متوقف شد", "bad");
        showViewerPlaceholder(true);
      }
      break;

    case "room-full":
    case "room-full-role":
    case "error":
      manualStop = true;
      setStatus(message.message || "خطایی رخ داد.");
      if (currentRole === "viewer") {
        setBadge("خطا", "bad");
      }
      break;

    case "replaced":
      manualStop = true;
      setStatus("این نشست از یک اتصال جدید جایگزین شد.");
      break;

    default:
      break;
  }
}

function createPeerConnection() {
  if (pc) return pc;

  pc = new RTCPeerConnection(RTC_CONFIG);
  pendingIceCandidates = [];
  addedTracks = false;

  pc.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      send({
        type: "ice",
        candidate: event.candidate.toJSON
          ? event.candidate.toJSON()
          : event.candidate
      });
    }
  });

  pc.addEventListener("connectionstatechange", () => {
    const state = pc?.connectionState;
    if (!state) return;

    if (currentRole === "viewer") {
      const labels = {
        connected: ["متصل", "good"],
        connecting: ["در حال اتصال", ""],
        disconnected: ["ارتباط ناپایدار", "bad"],
        failed: ["اتصال ناموفق", "bad"],
        closed: ["بسته شد", "bad"]
      };
      const [label, kind] = labels[state] || [state, ""];
      setBadge(label, kind);

      if (state === "connected") {
        setStatus("تصویر دریافت شد. برای شنیدن صدا دکمه «فعال کردن صدا» را بزنید.");
        showViewerPlaceholder(false);
      } else if (state === "failed") {
        setStatus("اتصال WebRTC ناموفق شد؛ در حال تلاش برای برقراری مجدد…");
        requestReconnect();
      }
    } else if (currentRole === "host") {
      const labels = {
        connected: "گوشی متصل شد؛ تصویر و صدا در حال ارسال است.",
        connecting: "در حال برقراری اتصال WebRTC…",
        disconnected: "ارتباط WebRTC ناپایدار است…",
        failed: "اتصال WebRTC شکست خورد؛ در حال تلاش مجدد…",
        closed: "اتصال بسته شد."
      };
      setStatus(labels[state] || `WebRTC: ${state}`);

      if (state === "failed") {
        requestReconnect();
      }
    }
  });

  pc.addEventListener("iceconnectionstatechange", () => {
    if (!pc) return;
    if (["failed", "disconnected"].includes(pc.iceConnectionState)) {
      // Let the connection state handler/retry logic take over.
      console.debug("ICE state:", pc.iceConnectionState);
    }
  });

  pc.addEventListener("track", (event) => {
    const video = $("video");
    const incomingStream =
      event.streams?.[0] ||
      new MediaStream([event.track]);

    if (video.srcObject !== incomingStream) {
      video.srcObject = incomingStream;
    }

    video.muted = true;
    showViewerPlaceholder(false);
  });

  return pc;
}

function addLocalTracks() {
  if (!localStream || !pc || addedTracks) return;

  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }
  addedTracks = true;
}

async function createOffer() {
  if (currentRole !== "host" || !localStream || offerInProgress) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  offerInProgress = true;
  try {
    if (!pc || ["closed", "failed"].includes(pc.connectionState)) {
      await resetPeerConnection();
    }

    createPeerConnection();
    addLocalTracks();

    const offer = await pc.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false
    });
    await pc.setLocalDescription(offer);

    send({
      type: "offer",
      offer: {
        type: pc.localDescription.type,
        sdp: pc.localDescription.sdp
      }
    });

    setStatus("پیشنهاد WebRTC ارسال شد؛ در حال اتصال گوشی…");
  } finally {
    offerInProgress = false;
  }
}

async function acceptOffer(offer) {
  createPeerConnection();

  await pc.setRemoteDescription(offer);
  await flushPendingIce();

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  send({
    type: "answer",
    answer: {
      type: pc.localDescription.type,
      sdp: pc.localDescription.sdp
    }
  });

  setStatus("پاسخ WebRTC ارسال شد؛ در حال دریافت تصویر و صدا…");
}

async function flushPendingIce() {
  if (!pc?.remoteDescription) return;

  const candidates = pendingIceCandidates.splice(0);
  for (const candidate of candidates) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      console.warn("Queued ICE candidate rejected:", error);
    }
  }
}

async function resetPeerConnection() {
  if (pc) {
    try {
      pc.ontrack = null;
      pc.close();
    } catch {}
  }

  pc = null;
  pendingIceCandidates = [];
  addedTracks = false;

  const video = $("video");
  if (video) {
    video.srcObject = null;
    video.muted = true;
  }
}

function requestReconnect() {
  if (currentRole === "host") {
    setTimeout(async () => {
      if (!manualStop && localStream && ws?.readyState === WebSocket.OPEN) {
        await resetPeerConnection();
        await createOffer();
      }
    }, 500);
  } else if (currentRole === "viewer") {
    send({ type: "request-offer" });
  }
}

function showViewerPlaceholder(show) {
  $("videoPlaceholder").hidden = !show;
}

function showWebRtcError(error) {
  const message = error?.message || String(error);

  if (currentRole === "viewer") {
    setStatus(`خطا در دریافت تصویر/صدا: ${message}`);
  } else {
    setStatus(`خطا: ${message}`);
  }
}

function describeCaptureError(error) {
  if (!error) return "اشتراک‌گذاری انجام نشد.";

  switch (error.name) {
    case "NotAllowedError":
      return "اجازه اشتراک‌گذاری داده نشد یا کاربر آن را لغو کرد. دوباره روی «شروع اشتراک‌گذاری» بزنید و در پنجره مرورگر اجازه را تأیید کنید.";
    case "NotFoundError":
      return "منبعی برای اشتراک‌گذاری پیدا نشد.";
    case "NotReadableError":
      return "مرورگر یا سیستم‌عامل نتوانست صفحه انتخاب‌شده را بخواند. پنجره دیگری را امتحان کنید.";
    case "AbortError":
      return "اشتراک‌گذاری توسط کاربر یا مرورگر متوقف شد.";
    case "InvalidStateError":
      return "درخواست اشتراک‌گذاری باید مستقیماً با کلیک کاربر انجام شود. دوباره دکمه را بزنید.";
    case "TypeError":
      return "مرورگر این گزینه‌های Screen Share را پشتیبانی نمی‌کند.";
    default:
      return `اشتراک‌گذاری انجام نشد: ${error.message || error.name || "خطای ناشناخته"}`;
  }
}

function explainAudioSupport(stream) {
  const hasAudio = stream.getAudioTracks().length > 0;

  if (hasAudio) {
    setNotice(
      "shareHelp",
      "صدای سیستم هم در Stream دریافت شد و همراه تصویر از طریق WebRTC ارسال می‌شود.",
      true
    );
  } else {
    setNotice(
      "shareHelp",
      "تصویر دریافت شد، اما مرورگر برای منبع انتخاب‌شده صدای قابل اشتراک‌گذاری نداد. در Chrome/Edge دسکتاپ هنگام انتخاب صفحه یا پنجره، گزینه «Share system audio» را فعال کنید. بعضی مرورگرها یا سیستم‌عامل‌ها اصلاً صدای سیستم را از getDisplayMedia ارائه نمی‌کنند.",
      true
    );
  }
}

async function startSharing() {
  manualStop = false;

  const room = normalizeRoom($("room").value) || makeRoomCode();
  if (room.length < 4) {
    $("room").value = makeRoomCode();
    setStatus("کد اتاق معتبر نیست؛ یک کد جدید ساخته شد.");
    return;
  }

  $("room").value = room;
  currentRoom = room;
  currentRole = "host";

  const shareUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
  $("link").href = shareUrl;
  $("link").textContent = shareUrl;
  $("linkBox").hidden = false;

  if (!window.isSecureContext && location.hostname !== "localhost") {
    setNotice(
      "shareHelp",
      "برای Screen Share در اینترنت باید صفحه با HTTPS باز شود.",
      true
    );
    setStatus("HTTPS لازم است.");
    return;
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    setStatus("این مرورگر Screen Share را پشتیبانی نمی‌کند. از Chrome یا Edge جدید روی کامپیوتر استفاده کنید.");
    return;
  }

  try {
    setStatus("پنجره انتخاب صفحه باز می‌شود…");

    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 60 },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: true,
      systemAudio: "include",
      windowAudio: "system",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      monitorTypeSurfaces: "include"
    });

    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) {
      throw new Error("مرورگر هیچ Video Trackای برنگرداند.");
    }

    videoTrack.addEventListener("ended", stopSharing);

    explainAudioSupport(localStream);
    setStatus(
      localStream.getAudioTracks().length
        ? "صفحه و صدای سیستم آماده است؛ لینک گوشی را باز کنید."
        : "صفحه آماده است؛ صدای سیستم توسط مرورگر ارائه نشد."
    );

    connectSignaling();
  } catch (error) {
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    setStatus(describeCaptureError(error));
  }
}

async function stopSharing() {
  if (!localStream) return;

  manualStop = true;
  send({ type: "stop-sharing" });

  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;

  await resetPeerConnection();

  if (ws) {
    try { ws.close(); } catch {}
  }

  setStatus("اشتراک‌گذاری متوقف شد.");
}

async function enableSound() {
  const video = $("video");
  if (!video) return;

  try {
    video.muted = false;
    video.volume = 1;
    await video.play();

    $("sound").textContent = "🔊 صدا فعال است";
    $("sound").disabled = true;
    setStatus("صدا فعال شد.");
  } catch (error) {
    video.muted = true;
    setNotice(
      "viewerHelp",
      "مرورگر اجازه پخش خودکار صدا را نداد. یک‌بار دیگر روی دکمه صدا بزنید یا کنترل صدای خود ویدئو را لمس کنید.",
      true
    );
    console.warn("Audio playback blocked:", error);
  }
}

async function manualReconnect() {
  manualStop = false;
  reconnectAttempt = 0;

  if (currentRole === "viewer") {
    await resetPeerConnection();
    setStatus("در حال اتصال مجدد…");
    setBadge("در حال اتصال");
    connectSignaling();
  } else if (currentRole === "host") {
    if (!localStream) {
      setStatus("ابتدا اشتراک‌گذاری صفحه را شروع کنید.");
      return;
    }
    await resetPeerConnection();
    connectSignaling();
  }
}

$("new").addEventListener("click", () => {
  $("room").value = makeRoomCode();
});

$("share").addEventListener("click", startSharing);
$("copy").addEventListener("click", async () => {
  const link = $("link").textContent;
  try {
    await navigator.clipboard.writeText(link);
    $("copy").textContent = "کپی شد ✓";
    setTimeout(() => $("copy").textContent = "کپی لینک", 1600);
  } catch {
    setStatus("کپی خودکار ممکن نشد؛ لینک را دستی کپی کنید.");
  }
});

$("sound").addEventListener("click", enableSound);
$("reconnect").addEventListener("click", manualReconnect);

if (roomFromUrl) {
  $("home").hidden = true;
  $("viewer").hidden = false;

  currentRoom = roomFromUrl;
  currentRole = "viewer";
  $("roomText").textContent = roomFromUrl;

  if (!window.isSecureContext && location.hostname !== "localhost") {
    setNotice(
      "viewerHelp",
      "این صفحه باید با HTTPS باز شود تا ارتباط امن و WebRTC به‌درستی کار کند.",
      true
    );
  }

  connectSignaling();
} else {
  $("room").value = makeRoomCode();
}
