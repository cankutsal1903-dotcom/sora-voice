# Gerçek Zamanlı Sesli Oda Kurulumu

Sora, mobil istemcide LiveKit React Native SDK'sını kullanır. Ses bağlantısı yalnızca imzalı token üreten sunucu üzerinden kurulur; `LIVEKIT_API_SECRET` kesinlikle APK'ya veya Git'e eklenmez.

## 1. LiveKit sunucusunu seçin

- Geliştirme için kendi bilgisayarınızda LiveKit çalıştırabilirsiniz.
- Canlı kullanım için LiveKit Cloud veya UDP portları açık bir VDS kullanın.

LiveKit URL'niz `wss://` ile başlamalıdır. Yerel ağ denemelerinde token sunucusu, telefonun ulaşabildiği bilgisayar IP'sinde çalışmalıdır.

## 2. Token sunucusunu yapılandırın

```powershell
Copy-Item server\.env.example server\.env
npm --prefix server install
```

`server\.env` içindeki değerleri doldurun:

```dotenv
PORT=3001
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
ALLOWED_ORIGIN=http://localhost:8081
```

Sonra token sunucusunu başlatın:

```powershell
npm run voice:server
```

Sunucu `GET /health` ile durum verir ve `POST /token` ile odaya özel, kısa ömürlü LiveKit tokenı üretir.

## 3. Mobil uygulamayı yapılandırın

```powershell
Copy-Item .env.example .env
```

Telefon ve bilgisayar aynı Wi-Fi ağındaysa `.env` içindeki adresi bilgisayarın LAN IP'siyle yazın:

```dotenv
EXPO_PUBLIC_TOKEN_SERVER_URL=http://192.168.1.40:3001
```

Uygulama odaya girerken tokenı bu uç noktadan ister, LiveKit'e bağlanır ve mikrofon durumunu gerçek bağlantıdan yönetir. Oda ekranındaki bağlantı çubuğu bağlanma, yeniden bağlanma, aktif bağlantı ve hata durumlarını gösterir.

## 4. Android ve iOS paketi

LiveKit yerel WebRTC modülleri kullandığı için Expo Go ile çalışmaz. `app.json` içindeki LiveKit eklentileri, mikrofon izinleri ve uygulama simgesi ancak yerel Android/iOS derlemesinde uygulanır.

APK üretmeden önce yerel yapılandırmayı güncelleyin:

```powershell
npx expo prebuild --clean
```

Ardından Android için gerçek bir release APK üretin. Bu proje için APK derleme adımı kullanıcı onayıyla en son çalıştırılmalıdır.
