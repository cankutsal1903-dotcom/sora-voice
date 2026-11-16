# Sora hediye tasarımları ve gönderim sahneleri

34 özgün şeffaf PNG illüstrasyonu `assets/gifts/v2/` altında paketlenir. Kutu, sohbet kaydı ve gönderim sahnesi aynı kaynağı kullanır. Neon Mikrofon ilk referans görseldir; kalan 33 hediye de yerleşik görüntü üretim aracıyla ayrı ayrı üretildi.

## Görsel üretim yönü

Ortak prompt: premium, özgün 3B mobil sanal hediye illüstrasyonu; parlak heykelsi malzemeler, mücevher renkleri, kobalt/camgöbeği koleksiyon vurguları, temiz siluet, şeffaf alpha arka plan, kare kompozisyon, tüm nesnenin görünmesi; metin, logo, filigran, arayüz çerçevesi yok. Konu her hediyenin kendi nesnesidir: kristal kalp, gülümseyen altın karakter, porselen kahve, üç renkli balon, şans kurabiyesi, kristal yıldız, kanatlı öpücük, yavru kedi, kulaklık, konuşma mikrofonu, alkış, projektör, yıldızlı mikrofon, DJ seti, konuşma tacı, yıldız kupası, gül buketi, neon mikrofon, disko topu, hilal, kayan yıldızlar, gökkuşağı, kristal kelebek, altın taç, kırmızı spor araba, altın spor araba, ışık şelalesi, gökyüzü treni, kraliyet arabası, kozmik balina, Anka, elmas aslan, yıldız gemisi, kraliyet sahnesi.

## Gönderim davranışı

`giftEffectRecipes.js` 34 ayrı hareket tarifini içerir. Kalp nabız atar; kahveden buhar yükselir; balonlar süzülür; araçlar sürerek geçer; kelebek ve Anka farklı yükselme yolları izler; balina yüzüş yayı çizer; Kraliyet Sahnesi perdeler ve projektörlerle açılır. Sahne süreleri 2,9–4,4 saniye, parçacık sayısı en fazla 18, bekleyen sahne sayısı en fazla 3 olur. Azaltılmış hareket tercihi kısa sabit gösterim kullanır.

Efekt yalnızca başarılı gönderim veya yeni Realtime hediye mesajı için tetiklenir. Geçmiş mesajlar tekrar oynatılmaz; olay ID ile yankı tekrarları engellenir. Oda küçültülürse sahne ve kuyruk temizlenir.

Soğuk PNG çözümleme sırasında animasyonun görselden önce bitmemesi için süre ancak gerçek `Image.onLoad` sonrasında başlar. Görsel yükleme hatası veya 8 saniyelik bekleme sınırı kuyruğu serbest bırakır. Bu düzeltmenin Waydroid etkisi ayrı cihaz doğrulaması gerektirir; web önizlemesi cihaz testi yerine geçmez.

## Tekrarlanabilir kontroller

```bash
npm run check
node scripts/verify-gift-designs.cjs
cd tools/gift-preview
../../node_modules/.bin/expo export --platform web
```

Önizleme gerçek React Native görsel/animasyon bileşenlerini kullanır, sunucu veya cüzdan işlemi yapmaz. Kurulum ve tarayıcı kontrolü için `tools/gift-preview/README.md` dosyasını oku. Beş temsili sahnenin iki farklı karesinde dönüşüm değişimi, 34 kart/35 yüklenen görsel ve sıfır tarayıcı istisnası doğrulandı. Android JavaScript/görsel export kontrolü geçti; imzalı APK ve Waydroid kurulumu GitHub workflow üzerinden takip edilir.
