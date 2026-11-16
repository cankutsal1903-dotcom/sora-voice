import { memo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

export const GIFT_CATEGORIES = [
  { key: "all", label: "Tümü" },
  { key: "affordable", label: "Uygun fiyatlı" },
  { key: "room", label: "Oda temalı" },
  { key: "mid", label: "Orta seviye" },
  { key: "luxury", label: "Gösterişli" },
];

export const DEFAULT_GIFT_CATALOG = [
  // Uygun fiyatlı (8)
  { id: "minik_kalp", name: "Minik Kalp", icon: "heart", color: "#FF5E8A", cost: 10_000, category: "affordable", minFamilyLevel: 0, sortOrder: 10 },
  { id: "gulumseme", name: "Gülümseme", icon: "happy", color: "#FFB02E", cost: 15_000, category: "affordable", minFamilyLevel: 0, sortOrder: 11 },
  { id: "kahve_molasi", name: "Kahve Molası", icon: "cafe", color: "#B87444", cost: 25_000, category: "affordable", minFamilyLevel: 0, sortOrder: 12 },
  { id: "renkli_balon", name: "Renkli Balon", icon: "balloon", color: "#4DA6FF", cost: 35_000, category: "affordable", minFamilyLevel: 0, sortOrder: 13 },
  { id: "sans_kurabiyesi", name: "Şans Kurabiyesi", icon: "sparkles", color: "#E89B2D", cost: 45_000, category: "affordable", minFamilyLevel: 0, sortOrder: 14 },
  { id: "parilti", name: "Parıltı", icon: "sparkles", color: "#38B6FF", cost: 60_000, category: "affordable", minFamilyLevel: 0, sortOrder: 15 },
  { id: "ucan_opucuk", name: "Uçan Öpücük", icon: "heart", color: "#F24976", cost: 75_000, category: "affordable", minFamilyLevel: 0, sortOrder: 16 },
  { id: "tatli_kedi", name: "Tatlı Kedi", icon: "happy", color: "#8B6CEF", cost: 90_000, category: "affordable", minFamilyLevel: 0, sortOrder: 17 },

  // Oda temalı (8)
  { id: "dinleyici_destegi", name: "Dinleyici Desteği", icon: "headset", color: "#2F80ED", cost: 50_000, category: "room", minFamilyLevel: 0, sortOrder: 20 },
  { id: "soz_sende", name: "Söz Sende", icon: "mic", color: "#2596FF", cost: 80_000, category: "room", minFamilyLevel: 0, sortOrder: 21 },
  { id: "alkis_yagmuru", name: "Alkış Yağmuru", icon: "sparkles", color: "#36A2EB", cost: 120_000, category: "room", minFamilyLevel: 0, sortOrder: 22 },
  { id: "sahne_isigi", name: "Sahne Işığı", icon: "sunny", color: "#F5A623", cost: 175_000, category: "room", minFamilyLevel: 0, sortOrder: 23 },
  { id: "mikrofon_yildizi", name: "Mikrofon Yıldızı", icon: "mic", color: "#4E7BFF", cost: 240_000, category: "room", minFamilyLevel: 0, sortOrder: 24 },
  { id: "dj_seti", name: "DJ Seti", icon: "musical-notes", color: "#7B5CFF", cost: 320_000, category: "room", minFamilyLevel: 0, sortOrder: 25 },
  { id: "konusma_taci", name: "Konuşma Tacı", icon: "trophy", color: "#D99B1E", cost: 400_000, category: "room", minFamilyLevel: 0, sortOrder: 26 },
  { id: "oda_yildizi", name: "Oda Yıldızı", icon: "star", color: "#1D6FE8", cost: 500_000, category: "room", minFamilyLevel: 0, sortOrder: 27 },

  // Orta seviye (10)
  { id: "gul_buketi", name: "Gül Buketi", icon: "rose", color: "#E03E65", cost: 150_000, category: "mid", minFamilyLevel: 0, sortOrder: 30 },
  { id: "neon_mikrofon", name: "Neon Mikrofon", icon: "mic", color: "#00B4FF", cost: 220_000, category: "mid", minFamilyLevel: 0, sortOrder: 31 },
  { id: "disko_topu", name: "Disko Topu", icon: "sparkles", color: "#8E54E9", cost: 300_000, category: "mid", minFamilyLevel: 0, sortOrder: 32 },
  { id: "ay_isigi", name: "Ay Işığı", icon: "moon", color: "#4B6CB7", cost: 400_000, category: "mid", minFamilyLevel: 0, sortOrder: 33 },
  { id: "yildiz_yagmuru", name: "Yıldız Yağmuru", icon: "star", color: "#2B5876", cost: 520_000, category: "mid", minFamilyLevel: 0, sortOrder: 34 },
  { id: "gokkusagi", name: "Gökkuşağı", icon: "sunny", color: "#3A8DFF", cost: 650_000, category: "mid", minFamilyLevel: 0, sortOrder: 35 },
  { id: "kristal_kelebek", name: "Kristal Kelebek", icon: "diamond", color: "#26C6DA", cost: 800_000, category: "mid", minFamilyLevel: 0, sortOrder: 36 },
  { id: "altin_tac", name: "Altın Taç", icon: "trophy", color: "#D49A1A", cost: 1_000_000, category: "mid", minFamilyLevel: 0, sortOrder: 37 },
  { id: "ferrari", name: "Ferrari", icon: "car-sport", color: "#D92534", cost: 1_250_000, category: "mid", minFamilyLevel: 0, sortOrder: 38 },
  { id: "lamborghini", name: "Lamborghini", icon: "car-sport", color: "#E09F1F", cost: 1_500_000, category: "mid", minFamilyLevel: 0, sortOrder: 39 },

  // Gösterişli (8)
  { id: "isik_selalesi", name: "Işık Şelalesi", icon: "water", color: "#1CA7EC", cost: 2_000_000, category: "luxury", minFamilyLevel: 0, sortOrder: 40 },
  { id: "gokyuzu_treni", name: "Gökyüzü Treni", icon: "train", color: "#2F6FE0", cost: 3_000_000, category: "luxury", minFamilyLevel: 0, sortOrder: 41 },
  { id: "kraliyet_arabasi", name: "Kraliyet Arabası", icon: "car-sport", color: "#B8860B", cost: 4_200_000, category: "luxury", minFamilyLevel: 0, sortOrder: 42 },
  { id: "kozmik_balina", name: "Kozmik Balina", icon: "water", color: "#1B3B82", cost: 5_500_000, category: "luxury", minFamilyLevel: 0, sortOrder: 43 },
  { id: "efsanevi_anka", name: "Efsanevi Anka", icon: "flame", color: "#E65C00", cost: 7_000_000, category: "luxury", minFamilyLevel: 0, sortOrder: 44 },
  { id: "elmas_aslan", name: "Elmas Aslan", icon: "diamond", color: "#1E56B5", cost: 8_500_000, category: "luxury", minFamilyLevel: 0, sortOrder: 45 },
  { id: "yildiz_gemisi", name: "Yıldız Gemisi", icon: "rocket", color: "#183468", cost: 10_000_000, category: "luxury", minFamilyLevel: 0, sortOrder: 46 },
  { id: "kraliyet_sahnesi", name: "Kraliyet Sahnesi", icon: "trophy", color: "#142952", cost: 12_000_000, category: "luxury", minFamilyLevel: 0, sortOrder: 47 },
];

// Original transparent collectible illustrations, bundled locally for offline use.
export const GIFT_ARTWORK_SOURCES = {
  minik_kalp: require("../../assets/gifts/v2/minik_kalp.png"),
  gulumseme: require("../../assets/gifts/v2/gulumseme.png"),
  kahve_molasi: require("../../assets/gifts/v2/kahve_molasi.png"),
  renkli_balon: require("../../assets/gifts/v2/renkli_balon.png"),
  sans_kurabiyesi: require("../../assets/gifts/v2/sans_kurabiyesi.png"),
  parilti: require("../../assets/gifts/v2/parilti.png"),
  ucan_opucuk: require("../../assets/gifts/v2/ucan_opucuk.png"),
  tatli_kedi: require("../../assets/gifts/v2/tatli_kedi.png"),
  dinleyici_destegi: require("../../assets/gifts/v2/dinleyici_destegi.png"),
  soz_sende: require("../../assets/gifts/v2/soz_sende.png"),
  alkis_yagmuru: require("../../assets/gifts/v2/alkis_yagmuru.png"),
  sahne_isigi: require("../../assets/gifts/v2/sahne_isigi.png"),
  mikrofon_yildizi: require("../../assets/gifts/v2/mikrofon_yildizi.png"),
  dj_seti: require("../../assets/gifts/v2/dj_seti.png"),
  konusma_taci: require("../../assets/gifts/v2/konusma_taci.png"),
  oda_yildizi: require("../../assets/gifts/v2/oda_yildizi.png"),
  gul_buketi: require("../../assets/gifts/v2/gul_buketi.png"),
  neon_mikrofon: require("../../assets/gifts/v2/neon_mikrofon.png"),
  disko_topu: require("../../assets/gifts/v2/disko_topu.png"),
  ay_isigi: require("../../assets/gifts/v2/ay_isigi.png"),
  yildiz_yagmuru: require("../../assets/gifts/v2/yildiz_yagmuru.png"),
  gokkusagi: require("../../assets/gifts/v2/gokkusagi.png"),
  kristal_kelebek: require("../../assets/gifts/v2/kristal_kelebek.png"),
  altin_tac: require("../../assets/gifts/v2/altin_tac.png"),
  ferrari: require("../../assets/gifts/v2/ferrari.png"),
  lamborghini: require("../../assets/gifts/v2/lamborghini.png"),
  isik_selalesi: require("../../assets/gifts/v2/isik_selalesi.png"),
  gokyuzu_treni: require("../../assets/gifts/v2/gokyuzu_treni.png"),
  kraliyet_arabasi: require("../../assets/gifts/v2/kraliyet_arabasi.png"),
  kozmik_balina: require("../../assets/gifts/v2/kozmik_balina.png"),
  efsanevi_anka: require("../../assets/gifts/v2/efsanevi_anka.png"),
  elmas_aslan: require("../../assets/gifts/v2/elmas_aslan.png"),
  yildiz_gemisi: require("../../assets/gifts/v2/yildiz_gemisi.png"),
  kraliyet_sahnesi: require("../../assets/gifts/v2/kraliyet_sahnesi.png"),
};

const NAME_TO_GIFT_ID = Object.fromEntries(
  DEFAULT_GIFT_CATALOG.map((item) => [item.name.toLocaleLowerCase("tr-TR"), item.id]),
);

export const resolveGiftRecipeKey = (giftId, giftName) => {
  if (giftId && Object.hasOwn(GIFT_ARTWORK_SOURCES, giftId)) return giftId;
  const normalizedName = String(giftName || "").trim().toLocaleLowerCase("tr-TR");
  return Object.hasOwn(NAME_TO_GIFT_ID, normalizedName) ? NAME_TO_GIFT_ID[normalizedName] : null;
};

/** Shared original illustration for catalog, chat receipt, and the animated gift scene. */
export const SoraGiftArtwork = memo(function SoraGiftArtwork({
  giftId,
  giftName,
  fallbackIcon = "gift",
  fallbackColor = "#2F80ED",
  size = 54,
}) {
  const key = resolveGiftRecipeKey(giftId, giftName);
  const source = GIFT_ARTWORK_SOURCES[key];
  if (source) {
    return (
      <Image
        source={source}
        resizeMode="contain"
        resizeMethod="resize"
        accessible={false}
        fadeDuration={0}
        style={{ width: size, height: size }}
      />
    );
  }
  // Future server-only catalog items remain usable until their illustration is shipped.
  const icon = Ionicons.glyphMap?.[fallbackIcon] ? fallbackIcon : "gift";
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={icon} size={Math.round(size * 0.58)} color={fallbackColor} />
    </View>
  );
});

export const LEVEL_BADGE_TIERS = [
  {
    tier: 0,
    minLevel: 1,
    maxLevel: 9,
    code: "sora_crest_t0",
    name: "Başlangıç Arması",
    rangeLabel: "Sv. 1 – 9",
    grad: ["#3A7BD5", "#1F4B8E", "#12284C"],
    border: "#8EC5FF",
    accent: "#DCEEFF",
    centerIcon: "shield-star",
    wings: false,
    crown: false,
    diamondBack: false,
    octagramBack: false,
    gems: 0,
  },
  {
    tier: 1,
    minLevel: 10,
    maxLevel: 19,
    code: "sora_crest_t1",
    name: "Gümüş Kanat Rozeti",
    rangeLabel: "Sv. 10 – 19",
    grad: ["#60A5FA", "#2563EB", "#172554"],
    border: "#E2E8F0",
    accent: "#F8FAFC",
    centerIcon: "medal",
    wings: true,
    wingColor: "#CBD5E1",
    crown: false,
    diamondBack: false,
    octagramBack: false,
    gems: 2,
  },
  {
    tier: 2,
    minLevel: 20,
    maxLevel: 29,
    code: "sora_crest_t2",
    name: "Altın Hare Rozeti",
    rangeLabel: "Sv. 20 – 29",
    grad: ["#F59E0B", "#2563EB", "#132347"],
    border: "#FDE047",
    accent: "#FEF08A",
    centerIcon: "shield-sun",
    wings: true,
    wingColor: "#FCD34D",
    crown: false,
    diamondBack: true,
    octagramBack: false,
    gems: 3,
  },
  {
    tier: 3,
    minLevel: 30,
    maxLevel: 39,
    code: "sora_crest_t3",
    name: "Kristal Taç Rozeti",
    rangeLabel: "Sv. 30 – 39",
    grad: ["#38BDF8", "#1D4ED8", "#0F172A"],
    border: "#67E8F9",
    accent: "#FDE047",
    centerIcon: "shield-crown",
    wings: true,
    wingColor: "#7DD3FC",
    crown: true,
    crownColor: "#FDE047",
    diamondBack: true,
    octagramBack: false,
    gems: 4,
  },
  {
    tier: 4,
    minLevel: 40,
    maxLevel: 49,
    code: "sora_crest_t4",
    name: "Asil Hükümran Rozeti",
    rangeLabel: "Sv. 40 – 49",
    grad: ["#FBBF24", "#1E40AF", "#090D24"],
    border: "#FDE68A",
    accent: "#67E8F9",
    centerIcon: "trophy-award",
    wings: true,
    doubleWings: true,
    wingColor: "#FBBF24",
    crown: true,
    crownColor: "#FEF08A",
    diamondBack: true,
    octagramBack: true,
    gems: 6,
  },
  {
    tier: 5,
    minLevel: 50,
    maxLevel: 999,
    code: "sora_crest_t5",
    name: "İmparatorluk Zirve Rozeti",
    rangeLabel: "Sv. 50+",
    grad: ["#FFE066", "#2563EB", "#060B1E"],
    border: "#FFF3B0",
    accent: "#72EFDD",
    centerIcon: "chess-king",
    wings: true,
    doubleWings: true,
    imperialAura: true,
    wingColor: "#FFE066",
    crown: true,
    crownColor: "#FFF8DC",
    diamondBack: true,
    octagramBack: true,
    gems: 8,
  },
];

export const getBadgeTierConfigForLevel = (rawLevel = 1) => {
  const lvl = Math.max(1, Math.floor(Number(rawLevel) || 1));
  const tierIndex = Math.min(5, Math.floor(lvl / 10));
  return LEVEL_BADGE_TIERS[tierIndex] || LEVEL_BADGE_TIERS[0];
};

/**
 * Her 10 seviyede bir (1, 10, 20, 30, 40, 50+) giderek daha şahşahlı hale gelen özel kullanıcı seviye rozeti.
 */
export const SoraLevelCrest = memo(function SoraLevelCrest({
  level = 1,
  size = 44,
  showLevelTag = false,
  locked = false,
}) {
  const tier = getBadgeTierConfigForLevel(level);
  const wingSize = Math.max(11, Math.round(size * 0.34));
  const crownSize = Math.max(10, Math.round(size * 0.3));
  const coreSize = Math.round(size * 0.78);
  const plateSize = Math.round(size * 0.66);

  return (
    <View
      style={[
        artStyles.crestRoot,
        {
          width: tier.wings ? Math.round(size * 1.28) : size,
          height: tier.crown ? Math.round(size * 1.16) : size,
          opacity: locked ? 0.45 : 1,
        },
      ]}
    >
      {/* İmparatorluk dış ışık halesi (Sv. 50+) */}
      {tier.imperialAura ? (
        <View
          pointerEvents="none"
          style={[
            artStyles.imperialHalo,
            {
              width: Math.round(size * 1.08),
              height: Math.round(size * 1.08),
              borderRadius: size,
              borderColor: "rgba(255,224,102,0.55)",
            },
          ]}
        />
      ) : null}

      {/* Sekiz köşeli şahşahlı arka yıldız plakası (Sv. 40+ ve 50+) */}
      {tier.octagramBack ? (
        <View
          pointerEvents="none"
          style={[
            artStyles.crestBackPlate,
            {
              width: plateSize,
              height: plateSize,
              borderRadius: Math.max(4, Math.round(size * 0.1)),
              borderColor: tier.border,
              backgroundColor: "rgba(37,99,235,0.28)",
              transform: [{ rotate: "22.5deg" }],
            },
          ]}
        />
      ) : null}

      {/* Elmas arka plaka (Sv. 20+) */}
      {tier.diamondBack ? (
        <View
          pointerEvents="none"
          style={[
            artStyles.crestBackPlate,
            {
              width: plateSize,
              height: plateSize,
              borderRadius: Math.max(4, Math.round(size * 0.12)),
              borderColor: tier.border,
              backgroundColor: "rgba(29,78,216,0.34)",
              transform: [{ rotate: "45deg" }],
            },
          ]}
        />
      ) : null}

      {/* Yan kanatlar (Sv. 10+ tek kanat, Sv. 40+ çift katmanlı kanat) */}
      {tier.wings ? (
        <>
          <View
            pointerEvents="none"
            style={[
              artStyles.wingLeft,
              { left: 0, transform: [{ rotate: "-24deg" }, { scaleX: -1 }] },
            ]}
          >
            <MaterialCommunityIcons name="feather" size={wingSize} color={tier.wingColor} />
          </View>
          <View
            pointerEvents="none"
            style={[
              artStyles.wingRight,
              { right: 0, transform: [{ rotate: "-24deg" }] },
            ]}
          >
            <MaterialCommunityIcons name="feather" size={wingSize} color={tier.wingColor} />
          </View>
          {tier.doubleWings ? (
            <>
              <View
                pointerEvents="none"
                style={[
                  artStyles.wingLeft,
                  {
                    left: Math.round(size * 0.04),
                    bottom: Math.round(size * 0.08),
                    transform: [{ rotate: "-48deg" }, { scaleX: -1 }],
                  },
                ]}
              >
                <MaterialCommunityIcons name="feather" size={Math.round(wingSize * 0.82)} color={tier.accent} />
              </View>
              <View
                pointerEvents="none"
                style={[
                  artStyles.wingRight,
                  {
                    right: Math.round(size * 0.04),
                    bottom: Math.round(size * 0.08),
                    transform: [{ rotate: "-48deg" }],
                  },
                ]}
              >
                <MaterialCommunityIcons name="feather" size={Math.round(wingSize * 0.82)} color={tier.accent} />
              </View>
            </>
          ) : null}
        </>
      ) : null}

      {/* Merkez madalyon */}
      <LinearGradient
        colors={tier.grad}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          artStyles.crestCore,
          {
            width: coreSize,
            height: coreSize,
            borderRadius: coreSize / 2,
            borderColor: tier.border,
            borderWidth: tier.tier >= 4 ? 2.2 : tier.tier >= 2 ? 1.8 : 1.4,
          },
        ]}
      >
        <View
          pointerEvents="none"
          style={[
            artStyles.crestInnerRing,
            {
              width: Math.round(coreSize * 0.78),
              height: Math.round(coreSize * 0.78),
              borderRadius: coreSize,
              borderColor: "rgba(255,255,255,0.34)",
            },
          ]}
        />
        <MaterialCommunityIcons
          name={tier.centerIcon}
          size={Math.max(12, Math.round(coreSize * 0.5))}
          color={tier.tier >= 4 ? "#FFF8DC" : "#FFFFFF"}
        />
      </LinearGradient>

      {/* Üst taç (Sv. 30+) */}
      {tier.crown ? (
        <View pointerEvents="none" style={[artStyles.crestCrown, { top: 0 }]}>
          <MaterialCommunityIcons name="crown" size={crownSize} color={tier.crownColor} />
        </View>
      ) : null}

      {/* Köşe mücevher parıltıları (Sv. 20+) */}
      {tier.gems >= 3 ? (
        <>
          <View pointerEvents="none" style={[artStyles.gemTopLeft, { top: Math.round(size * 0.1), left: Math.round(size * 0.16) }]}>
            <MaterialCommunityIcons name="star-four-points" size={Math.max(8, Math.round(size * 0.2))} color={tier.accent} />
          </View>
          <View pointerEvents="none" style={[artStyles.gemTopRight, { top: Math.round(size * 0.1), right: Math.round(size * 0.16) }]}>
            <MaterialCommunityIcons name="star-four-points" size={Math.max(8, Math.round(size * 0.2))} color={tier.accent} />
          </View>
        </>
      ) : null}

      {showLevelTag ? (
        <View style={[artStyles.crestLevelPill, { borderColor: tier.border }]}>
          <Text style={artStyles.crestLevelText}>Sv.{level}</Text>
        </View>
      ) : null}
    </View>
  );
});

const artStyles = StyleSheet.create({
  crestRoot: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  imperialHalo: {
    position: "absolute",
    borderWidth: 1.5,
    backgroundColor: "rgba(255,224,102,0.12)",
  },
  crestBackPlate: {
    position: "absolute",
    borderWidth: 1.3,
  },
  wingLeft: {
    position: "absolute",
    zIndex: 1,
  },
  wingRight: {
    position: "absolute",
    zIndex: 1,
  },
  crestCore: {
    zIndex: 3,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#09152E",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  crestInnerRing: {
    position: "absolute",
    borderWidth: 1,
  },
  crestCrown: {
    position: "absolute",
    zIndex: 5,
  },
  gemTopLeft: {
    position: "absolute",
    zIndex: 4,
  },
  gemTopRight: {
    position: "absolute",
    zIndex: 4,
  },
  crestLevelPill: {
    position: "absolute",
    bottom: -4,
    zIndex: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 99,
    backgroundColor: "#0F1D38",
    borderWidth: 1,
  },
  crestLevelText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
});
