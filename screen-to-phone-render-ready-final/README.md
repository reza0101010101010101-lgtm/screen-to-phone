# Screen to Phone

این پروژه یک **کامپیوتر فرستنده** و یک **گوشی گیرنده** را با WebRTC به هم وصل می‌کند تا صفحه‌نمایش کامپیوتر و در صورت پشتیبانی مرورگر، صدای سیستم نیز روی گوشی پخش شود.

معماری:

```text
PC Browser
  │
  │ getDisplayMedia()
  │ video + optional system audio
  ▼
WebRTC
  │
  │  مستقیم بین دو مرورگر
  ▼
Phone Browser

Node.js + WebSocket
  └── فقط signaling: Room / Offer / Answer / ICE
```

سرور فایل و صفحه را سرو می‌کند و پیام‌های signaling را بین دو Peer ردوبدل می‌کند؛ **ویدئو و صدا از داخل WebSocket عبور نمی‌کنند**.

## امکانات

- ساخت Room با کد تصادفی کوتاه
- ورود گوشی با لینک `?room=CODE`
- ورود دستی با کد نیز در معماری Room پشتیبانی شده است
- یک Host و یک Viewer در هر Room
- جداسازی کامل Roomها
- WebRTC برای انتقال Video و Audio
- `offer / answer / ICE candidate`
- صف‌کردن ICE candidateهایی که زودتر از Remote Description می‌رسند
- reconnect خودکار WebSocket
- تلاش مجدد WebRTC در صورت شکست ICE
- heartbeat برای WebSocket
- رابط فارسی و موبایل‌پسند
- پیام خطای واضح برای Permission و Screen Share
- آماده Deploy روی Render
- بدون localhost یا IP ثابت در production

---

# 1. پیش‌نیاز

Node.js نسخه 18 یا جدیدتر لازم است. برای Deploy فعلی Render، Node.js 20 در `render.yaml` انتخاب شده است.

نسخه Node را بررسی کنید:

```bash
node -v
npm -v
```

---

# 2. نصب

در پوشه پروژه:

```bash
npm install
```

---

# 3. اجرای محلی

سرور را اجرا کنید:

```bash
npm start
```

سپس روی کامپیوتر باز کنید:

```text
http://localhost:3000
```

یک Room Code برای شما ساخته می‌شود.

مثلاً:

```text
A7K2P9
```

پس از شروع اشتراک‌گذاری، لینک گوشی به شکل زیر خواهد بود:

```text
http://localhost:3000/?room=A7K2P9
```

برای تست واقعی روی اینترنت، نسخه Deploy شده HTTPS را استفاده کنید.

> توجه: `localhost` فقط روی همان کامپیوتر معنی دارد. اگر لینک localhost را برای گوشی بفرستید، گوشی به localhost خودش وصل می‌شود، نه کامپیوتر شما.

---

# 4. ساخت Room

در صفحه اصلی:

1. کد Room را ببینید یا روی «کد جدید» بزنید.
2. روی «شروع اشتراک‌گذاری» کلیک کنید.
3. پنجره انتخاب صفحه مرورگر باز می‌شود.
4. صفحه، مانیتور یا پنجره موردنظر را انتخاب کنید.
5. اگر مرورگر گزینه **Share system audio** را نشان داد، آن را فعال کنید.
6. لینک نمایش داده‌شده را برای گوشی بفرستید.

---

# 5. اتصال گوشی

گوشی باید لینک زیر را باز کند:

```text
https://YOUR-APP.onrender.com/?room=A7K2P9
```

گوشی به عنوان Viewer وارد Room می‌شود.

وقتی WebRTC متصل شد، تصویر روی گوشی نمایش داده می‌شود.

برای شنیدن صدا، روی:

```text
🔊 فعال کردن صدا
```

بزنید.

این دکمه عمداً وجود دارد چون مرورگرهای موبایل معمولاً برای پخش صدای Media دریافتی، تعامل کاربر را ترجیح می‌دهند.

---

# 6. صدای سیستم

کد از این درخواست استفاده می‌کند:

```js
navigator.mediaDevices.getDisplayMedia({
  video: { ... },
  audio: true,
  systemAudio: "include",
  windowAudio: "system"
});
```

اما **هیچ وب‌سایتی نمی‌تواند پشتیبانی صدای سیستم را در تمام مرورگرها تضمین کند**.

`getDisplayMedia()` فقط در مرورگرها/سیستم‌عامل‌هایی که Audio Capture را برای منبع انتخاب‌شده ارائه می‌کنند، Audio Track برمی‌گرداند.

برای بهترین نتیجه:

- روی کامپیوتر از Chrome یا Edge جدید استفاده کنید.
- هنگام Screen Share گزینه مربوط به صدای سیستم را فعال کنید.
- اگر گزینه Share system audio وجود نداشت، مرورگر/سیستم‌عامل ممکن است Audio Capture آن منبع را پشتیبانی نکند.
- در این حالت تصویر همچنان ارسال می‌شود، ولی Stream شامل Audio Track نخواهد بود.

---

# 7. HTTPS

برای استفاده عمومی باید برنامه از HTTPS باز شود.

Render به صورت خودکار برای Web Service یک دامنه `onrender.com` و TLS/HTTPS فراهم می‌کند.

بنابراین بعد از Deploy باید آدرسی شبیه این داشته باشید:

```text
https://screen-to-phone-xxxx.onrender.com
```

و WebSocket مرورگر به صورت خودکار از:

```text
wss://...
```

استفاده می‌کند.

در production نباید URL یا IP ثابت داخل JavaScript نوشته شود.

---

# 8. Deploy روی Render

## روش پیشنهادی

پروژه را روی GitHub قرار دهید.

در Render:

1. وارد Dashboard شوید.
2. گزینه **New → Web Service** را انتخاب کنید.
3. Repository پروژه را انتخاب کنید.
4. تنظیمات زیر را استفاده کنید:

```text
Runtime:
Node

Build Command:
npm install

Start Command:
npm start

Health Check Path:
/health
```

`render.yaml` نیز همین تنظیمات را تعریف کرده است.

بعد از Deploy، Render یک URL HTTPS به شما می‌دهد.

مثلاً:

```text
https://YOUR-APP.onrender.com
```

---

# 9. WebSocket روی Render

سرور از پکیج `ws` استفاده می‌کند و WebSocket روی همان HTTP server اجرا می‌شود.

در مرورگر:

```js
const protocol = location.protocol === "https:" ? "wss:" : "ws:";
const url = `${protocol}//${location.host}`;
```

بنابراین:

- Local HTTP → `ws://`
- Public HTTPS → `wss://`

Render از WebSocket روی Web Service پشتیبانی می‌کند.

برای تشخیص اتصال‌های مرده نیز سرور heartbeat/ping دارد و کلاینت در صورت قطع signaling تلاش به reconnect می‌کند.

---

# 10. WebRTC و Signaling

سرور فقط این پیام‌ها را بین دو Peer عبور می‌دهد:

```text
join
offer
answer
ice
request-offer
peer-joined
peer-left
```

Stream رسانه‌ای داخل Node.js عبور نمی‌کند.

جریان اصلی:

```text
Host:
  getDisplayMedia()
       ↓
  MediaStream
       ↓
  RTCPeerConnection.addTrack()
       ↓
  createOffer()
       ↓
  WebSocket signaling
       ↓
Viewer:
  setRemoteDescription()
       ↓
  createAnswer()
       ↓
  WebSocket signaling
       ↓
Host:
  setRemoteDescription()
```

ICE candidateها نیز از WebSocket عبور می‌کنند و در مقصد با:

```js
pc.addIceCandidate(...)
```

اضافه می‌شوند.

---

# 11. STUN و TURN

پروژه در حالت پیش‌فرض از STUN عمومی استفاده می‌کند تا WebRTC بتواند مسیر مستقیم بین دستگاه‌ها را پیدا کند.

این برای بسیاری از شبکه‌ها کافی است.

اما STUN به تنهایی تضمین نمی‌کند که همه شبکه‌ها متصل شوند.

اگر یکی از دستگاه‌ها پشت NAT یا Firewall محدودکننده باشد، ممکن است WebRTC نتواند مسیر مستقیم پیدا کند. در آن شرایط **TURN server** لازم است.

این پروژه عمداً Username/Password مربوط به TURN را داخل GitHub قرار نمی‌دهد.

برای یک نسخه کاملاً production و اتصال مطمئن‌تر بین شبکه‌های سخت، یک TURN provider تهیه کنید و credentials آن را به صورت Secret/Environment Variable مدیریت کنید.

---

# 12. چرا Server Stream را منتقل نمی‌کند؟

اگر Node.js بخواهد ویدئو را دریافت و دوباره برای گوشی ارسال کند:

```text
PC → Server → Phone
```

پهنای‌باند و CPU سرور بسیار بالا می‌رود.

در معماری این پروژه:

```text
PC ───────────────→ Phone
       WebRTC
```

و Node.js فقط:

```text
PC ↔ Signaling Server ↔ Phone
```

است.

این روش برای هدف پروژه بسیار مناسب‌تر است.

---

# 13. محدودیت‌های مهم مرورگر

## Screen Share

`getDisplayMedia()` در محیط Secure Context استفاده می‌شود؛ برای اینترنت عمومی HTTPS لازم است.

## System Audio

پشتیبانی Audio Capture بین مرورگرها و سیستم‌عامل‌ها متفاوت است.

ممکن است:

```text
Video Track = موجود
Audio Track = موجود
```

یا:

```text
Video Track = موجود
Audio Track = موجود نیست
```

در حالت دوم برنامه متوقف نمی‌شود و فقط به کاربر اطلاع می‌دهد.

## Mobile autoplay

ممکن است گوشی اجازه پخش خودکار صدای WebRTC را ندهد.

برای همین Viewer دکمه:

```text
فعال کردن صدا
```

دارد.

## iPhone / Safari

پشتیبانی WebRTC خوب است، اما محدودیت‌های autoplay و Screen/Audio Capture می‌تواند متفاوت باشد. برای ارسال Screen از کامپیوتر، بهتر است Capture روی Chrome/Edge دسکتاپ انجام شود و گوشی فقط Viewer باشد.

---

# 14. اگر تصویر می‌آید ولی صدا نمی‌آید

به ترتیب:

1. روی کامپیوتر Chrome یا Edge جدید را امتحان کنید.
2. Screen Share را دوباره شروع کنید.
3. در پنجره انتخاب Screen گزینه Share system audio را فعال کنید.
4. اگر پنجره انتخاب‌شده فقط Video Track تولید می‌کند، یک Screen/Monitor یا منبع دیگری را امتحان کنید.
5. روی گوشی «فعال کردن صدا» را بزنید.
6. صدای گوشی را بررسی کنید.
7. اگر در مرورگر کامپیوتر گزینه Share system audio اصلاً وجود ندارد، محدودیت همان Browser/OS است و WebRTC نمی‌تواند آن را از JavaScript مجبور به تولید Audio Track کند.

---

# 15. اگر گوشی وصل نمی‌شود

بررسی کنید:

- URL با `https://` شروع شود.
- Room Code دقیقاً یکی باشد.
- کامپیوتر هنوز در همان Room باشد.
- مرورگر کامپیوتر Screen Share را متوقف نکرده باشد.
- در DevTools خطای WebSocket وجود نداشته باشد.
- در شبکه‌های شرکتی/VPN/Firewall شدید، TURN تنظیم شده باشد.

---

# 16. امنیت Room

Room Code فقط برای پیدا کردن Peer استفاده می‌شود و نباید به عنوان رمز عبور یا سیستم احراز هویت در نظر گرفته شود.

در این نسخه:

- Roomها در حافظه سرور نگهداری می‌شوند.
- اطلاعات Room در فایل یا دیتابیس دائمی ذخیره نمی‌شود.
- Secret یا password داخل source code قرار داده نشده است.
- هر Room حداکثر یک Host و یک Viewer دارد.
- پیام‌های یک Room به Room دیگر broadcast نمی‌شوند.

اگر پروژه برای محتوای خصوصی/حساس استفاده می‌شود، باید Authentication و authorization واقعی نیز اضافه شود.

---

# 17. Health Check

آدرس زیر برای بررسی وضعیت سرور وجود دارد:

```text
https://YOUR-APP.onrender.com/health
```

باید JSON مشابه زیر برگرداند:

```json
{
  "ok": true,
  "service": "screen-to-phone"
}
```

---

# 18. ساختار پروژه

```text
screen-to-phone/
├── server.js
├── package.json
├── render.yaml
├── README.md
├── README-RENDER.md
└── public/
    ├── index.html
    ├── app.js
    └── style.css
```

---

# 19. تست نهایی پیشنهادی

بعد از Deploy:

### کامپیوتر

```text
https://YOUR-APP.onrender.com
```

### گوشی

```text
https://YOUR-APP.onrender.com/?room=XXXXXX
```

سپس:

```text
PC
 ↓
Start sharing
 ↓
Select screen
 ↓
Enable system audio
 ↓
Phone opens room
 ↓
WebSocket signaling
 ↓
Offer
 ↓
Answer
 ↓
ICE candidates
 ↓
WebRTC connected
 ↓
Video + Audio
```

اگر WebRTC نتواند مسیر مستقیم بین دو شبکه پیدا کند، TURN لازم خواهد بود.

---

## نکته مهم درباره Render Free

Render Web Service از WebSocket پشتیبانی می‌کند و برای سرویس‌های عمومی HTTPS/TLS ارائه می‌دهد. با این حال، سرویس رایگان ممکن است پس از بی‌فعالیتی به حالت sleep برود و برای درخواست بعدی زمان بیدارشدن داشته باشد.

همچنین WebSocket ممکن است به علت restart، maintenance یا مشکلات شبکه قطع شود؛ کد کلاینت reconnect و کد سرور heartbeat دارد، اما هیچ WebSocket عمومی را نمی‌توان از قطع شبکه مصون کرد.
