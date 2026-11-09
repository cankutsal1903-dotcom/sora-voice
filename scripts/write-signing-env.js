// Imzalama bilgilerini Gradle'in okuyacagi bir .env dosyasina yazar.
// Sirlar ekrana basilmaz.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cred = JSON.parse(fs.readFileSync(path.join(root, "credentials.json"), "utf8"));
const k = cred.android.keystore;

const ksPath = path.isAbsolute(k.keystorePath)
  ? k.keystorePath
  : path.join(root, k.keystorePath);

if (!fs.existsSync(ksPath)) {
  console.error("Keystore bulunamadi:", ksPath);
  process.exit(1);
}

const lines = [
  "SORA_RELEASE_STORE_FILE=" + ksPath.replace(/\\/g, "/"),
  "SORA_RELEASE_STORE_PASSWORD=" + k.keystorePassword,
  "SORA_RELEASE_KEY_ALIAS=" + k.keyAlias,
  "SORA_RELEASE_KEY_PASSWORD=" + k.keyPassword,
];

const outPath = path.join(require("os").tmpdir(), "sora-signing.env");
fs.writeFileSync(outPath, lines.join("\n"), { mode: 0o600 });
console.log("Imzalama degiskenleri yazildi:", outPath);
console.log("Anahtar sayisi:", lines.length);