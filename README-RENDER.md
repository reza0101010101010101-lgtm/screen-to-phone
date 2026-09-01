# Deploy روی Render

این پروژه برای Render Web Service آماده شده است.

## تنظیمات

```text
Build Command:
npm install

Start Command:
npm start

Health Check:
 /health
```

فایل `render.yaml` همین تنظیمات را تعریف می‌کند.

## Deploy

1. Repository را روی GitHub قرار دهید.
2. در Render گزینه New → Web Service را انتخاب کنید.
3. Repository را متصل کنید.
4. Deploy را انجام دهید.
5. URL HTTPS ساخته‌شده را باز کنید.

مثال:

```text
https://screen-to-phone-xxxx.onrender.com
```

## WebSocket

برنامه WebSocket را روی همان HTTP server اجرا می‌کند.

در HTTPS مرورگر به صورت خودکار:

```text
wss://YOUR-APP.onrender.com
```

را استفاده می‌کند.

## نکته مهم

Render WebSocket را پشتیبانی می‌کند، اما WebSocket به علت restart سرویس یا مشکلات شبکه ممکن است قطع شود. برنامه heartbeat و reconnect دارد.

## WebRTC

Render فقط signaling را انجام می‌دهد.

مسیر Media:

```text
PC ===== WebRTC =====> Phone
```

است.

اگر شبکه‌ها اجازه اتصال مستقیم WebRTC ندهند، یک TURN server لازم است.

## TURN

هیچ TURN username/password داخل Repository قرار ندهید.

در صورت نیاز، TURN credentials را به عنوان Environment Variable/Secret در Render تنظیم کنید و کد WebRTC را برای خواندن آن‌ها configure کنید.

## تست

پس از Deploy:

```text
https://YOUR-APP.onrender.com
```

روی کامپیوتر و:

```text
https://YOUR-APP.onrender.com/?room=XXXXXX
```

روی گوشی باز کنید.
