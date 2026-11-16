# Sora hediye stüdyosu

Uygulamanın gerçek `SoraGiftArtwork` ve `SoraGiftEffect` bileşenlerini kullanan izole Expo web önizlemesi. Sunucu bağlantısı ve coin harcaması yoktur.

Ana proje bağımlılıkları kurulduktan sonra bu klasörde:

```bash
ln -s ../../node_modules node_modules # yalnızca bağlantı henüz yoksa
../../node_modules/.bin/expo export --platform web
../../node_modules/.bin/expo start --web --port 8092
```

Galeri sayfasında 34 hediyeye tıklayıp gerçek animasyonu oynatabilirsin. Telefon görünümü: `/?scene=1&gift=minik_kalp&play=1`; `gift` katalog ID'sidir. Sahnede oynat/önceki/sonraki ve tümünü sırayla oynat kontrolleri bulunur. Sistem hareket azaltma tercihi gerçek bileşene uygulanır.
