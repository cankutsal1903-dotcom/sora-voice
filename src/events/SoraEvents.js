/**
 * Sora — Etkinlikler modülü (uygulama içi etkinlikler, ağırlıklı hediye etkinlikleri).
 *
 * Kendi kendine yeten modül:
 *  - Supabase `public.app_events` tablosundan etkinlikleri okur; tablo/RPC yoksa
 *    veya hata verirse yerleşik haftalık varsayılan etkinliklere düşer.
 *  - Liderlik tablosu `public.get_event_leaderboard` RPC'sinden gelir; yoksa boş durum gösterilir.
 *  - Tüm animasyonlar native driver (transform/opacity) ile çalışır, unmount'ta durur,
 *    "hareketi azalt" açıkken statik kalır.
 *
 * Dışa aktarılanlar:
 *  - getDefaultEvents(now?)
 *  - useSoraEvents() -> { events, loading, refresh }
 *  - useEventCountdown(endsAt, variant?) -> "2g 14s 05d" | "3s 12d 40sn"
 *  - EventBannerCarousel, RoomEventCard, EventDetailSheet
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../auth/supabase";
import { SoraGiftArtwork } from "../ui/SoraGiftArtwork";
import { useReducedMotion } from "../ui/Motion";
import { PROFILE_ITEM_APPEARANCE } from "../ui/SoraProfileFrame";

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const UPCOMING_WINDOW_MS = 3 * DAY_MS;
const EVENTS_CACHE_TTL_MS = 60_000;
const LEADERBOARD_CACHE_TTL_MS = 30_000;
const LEADERBOARD_LIMIT = 20;
const AUTO_ADVANCE_MS = 5_000;
const ROOM_ROTATE_MS = 6_000;
const CARD_GAP = 0;
const BANNER_HEIGHT = 128;
// Etkinlik türüne göre render edilmiş banner görseli (Keşfet + Detay hero sürekliliği).
const EVENT_BANNER_ART = {
  gift_race: require("../../assets/events/gift-race.webp"),
  room_party: require("../../assets/events/royal-night.webp"),
  love: require("../../assets/events/love-week.webp"),
  family_war: require("../../assets/events/family-war.webp"),
};
const GOLD_BUTTON = ["#FFE9A8", "#F2B33D", "#C98A1E"];
const STAGE_BASE = "#0A1120";
const COINS_ART = require("../../assets/events/coins.webp");
const HERO_HEIGHT = 186;

// Etkinlik detay sayfası — 4 etkinlikte birebir aynı iskelet, etkinliğe özel atmosfer ve 3D CTA ikonu.
const EVENT_STAGE_THEME = {
  gift_race: {
    stageTop: "#081C42",
    glow: "rgba(47,128,237,0.44)",
    unitIcon: "trophy",
    unitColor: "#F6C86E",
    ctaColors: ["#164DA8", "#2F80ED", "#1D68D8"],
    ctaShadow: "#2F80ED",
    ctaIcon: require("../../assets/events/cta-race.webp"),
    defaultCta: "Hediye Gönder ve Katıl",
  },
  room_party: {
    stageTop: "#1B103F",
    glow: "rgba(139,92,246,0.44)",
    unitIcon: "sparkles",
    unitColor: "#F6C86E",
    ctaColors: ["#5B21B6", "#7C3AED", "#6D28D9"],
    ctaShadow: "#7C3AED",
    ctaIcon: require("../../assets/events/cta-royal.webp"),
    defaultCta: "Kraliyet Sahnesi Gönder",
  },
  love: {
    stageTop: "#330B24",
    glow: "rgba(236,72,153,0.42)",
    unitIcon: "heart",
    unitColor: "#FF6B9A",
    ctaColors: ["#D91B5C", "#F43F7E", "#EC4899"],
    ctaShadow: "#F43F7E",
    ctaIcon: require("../../assets/events/cta-love.webp"),
    defaultCta: "Minik Kalp Gönder",
  },
  family_war: {
    stageTop: "#0B1B3B",
    glow: "rgba(59,130,246,0.42)",
    unitIcon: "flash",
    unitColor: "#60A5FA",
    ctaColors: ["#1E3A8A", "#2563EB", "#1D4ED8"],
    ctaShadow: "#2563EB",
    ctaIcon: require("../../assets/events/cta-family.webp"),
    defaultCta: "Ailen İçin Hediye Gönder",
  },
};

// Hero görselinin yalnızca sağ sahne bölgesinde parlayan ince 4 köşeli yıldızlar: [sol %, üst %, boyut, grup]
const HERO_SPARKLES = [
  [60, 22, 12, 0],
  [82, 18, 10, 1],
  [90, 48, 13, 0],
  [67, 64, 9, 1],
];

// Safir-lacivert emaye + fırçalanmış altın kenarlı 3D podyum (PIL ile ölçülmüş silindir koordinatları).
const PODIUM_STAGE = {
  src: require("../../assets/events/podium-stage.webp"),
  aspect: 960 / 350,
  steps: {
    1: { cx: 0.4995, top: 0.0086, rim: 0.1114, seat: 6 },
    2: { cx: 0.1578, top: 0.2171, rim: 0.3486, seat: 10 },
    3: { cx: 0.8417, top: 0.3600, rim: 0.4971, seat: 11 },
  },
};

// İlk 3 kademe çerçeveleri (PIL ile ölçülmüş iç delik cx/cy/hole oranları — yakutsuz Sora safir-altın dili).
const STAGE_FRAMES = {
  1: { src: require("../../assets/events/frame-rank1-sora.webp"), aspect: 391 / 460, hole: 0.5739, cx: 0.4989, cy: 0.5384, avatar: 56 },
  2: { src: require("../../assets/events/frame-silver.webp"), aspect: 347 / 360, hole: 0.6361, cx: 0.4986, cy: 0.4813, avatar: 44 },
  3: { src: require("../../assets/events/frame-bronze.webp"), aspect: 350 / 360, hole: 0.6500, cx: 0.4986, cy: 0.4900, avatar: 44 },
};

const RANK_COIN_THEMES = {
  1: { colors: ["#FFF0B3", "#F5B83D", "#C78214"], text: "#543300" },
  2: { colors: ["#F8FAFC", "#CBD5E1", "#8A99AE"], text: "#2D3748" },
  3: { colors: ["#FAD4B0", "#D98E54", "#9E5727"], text: "#4A2309" },
};

const REWARD_PILL_THEMES = {
  gold: { bg: "rgba(251,191,36,0.22)", border: "rgba(251,191,36,0.45)", text: "#FDE68A", glow: "#F6C86E" },
  silver: { bg: "rgba(203,213,225,0.18)", border: "rgba(203,213,225,0.35)", text: "#E2E8F0", glow: "#93C5FD" },
  bronze: { bg: "rgba(251,146,60,0.20)", border: "rgba(251,146,60,0.40)", text: "#FED7AA", glow: "#F59E0B" },
  blue: { bg: "rgba(47,128,237,0.22)", border: "rgba(96,165,250,0.40)", text: "#93C5FD", glow: "#60A5FA" },
};

// Ödül metnindeki anahtar kelime -> gerçek Sora profil çerçevesi.
const REWARD_FRAME_KEYWORDS = [
  ["alev", "frame_flame", "#F97316"],
  ["kehribar", "frame_amber", "#F59E0B"],
  ["kraliyet", "frame_family_royal", "#3B82F6"],
  ["taç", "frame_family_royal", "#3B82F6"],
  ["asil", "frame_family_royal", "#3B82F6"],
  ["gümüş aile", "frame_family_silver", "#60A5FA"],
  ["lila", "frame_lilac", "#A855F7"],
  ["mor ", "frame_lilac", "#A855F7"],
  ["pembe", "frame_lilac", "#EC4899"],
  ["kanat", "frame_lilac", "#EC4899"],
];

// Yakutsuz Sora rozet ödülleri (altın-safir, asil, gümüş-safir, bronz-kehribar).
const REWARD_BADGES = {
  gold: { src: require("../../assets/events/badge-champion.webp"), glow: "#3B82F6" },
  royal: { src: require("../../assets/events/badge-royal.webp"), glow: "#8B5CF6" },
  silver: { src: require("../../assets/events/badge-silver.webp"), glow: "#93C5FD" },
  bronze: { src: require("../../assets/events/badge-bronze-clean.webp"), glow: "#F59E0B" },
};

const REWARD_BADGE_KEYWORDS = [
  ["asil", "royal"],
  ["gümüş", "silver"],
  ["bronz", "bronze"],
];

const resolveRewardVisual = (label) => {
  const text = String(label || "").toLocaleLowerCase("tr-TR");
  if (text.includes("rozet")) {
    const badge = REWARD_BADGE_KEYWORDS.find(([key]) => text.includes(key));
    const entry = REWARD_BADGES[badge ? badge[1] : "gold"];
    return { source: entry.src, isFrame: false, glow: entry.glow };
  }
  const hit = REWARD_FRAME_KEYWORDS.find(([key]) => text.includes(key));
  if (hit && PROFILE_ITEM_APPEARANCE[hit[1]]?.asset) {
    return { source: PROFILE_ITEM_APPEARANCE[hit[1]].asset, isFrame: true, glow: hit[2] };
  }
  return { source: COINS_ART, isFrame: false, glow: "#F6C86E" };
};

const rewardDays = (label) => {
  const match = String(label || "").match(/(\d+)\s*gün/i);
  return match ? `${match[1]} gün` : null;
};

const rewardSubtitle = (reward) => {
  const cleaned = String(reward?.label || "")
    .replace(/\s*\d+\s*gün/gi, "")
    .replace(/\s*vitrini/gi, "")
    .trim();
  const lower = cleaned.toLocaleLowerCase("tr-TR");
  if (!cleaned || lower === "kredi ödülü") {
    const rankStr = String(reward?.rank || "").trim();
    if (rankStr === "1." || rankStr === "1") return "Birinciye özel ödül";
    if (rankStr.includes("-")) return "Kişi başı kredi";
    return "Kredi ödülü";
  }
  return cleaned.charAt(0).toLocaleUpperCase("tr-TR") + cleaned.slice(1);
};

const rewardTierKey = (rank) => {
  const text = String(rank ?? "").trim();
  const num = parseInt(text, 10);
  if (num === 1 && !text.includes("-")) return "gold";
  if (num === 2) return "silver";
  if (num === 3 && !text.includes("-")) return "bronze";
  return "blue";
};

const BRAND = {
  blue: "#1C5FB8",
  blueBright: "#2F80ED",
  ink: "#101820",
  navy: "#1D2E43",
  gold: "#F6C86E",
  goldLight: "#FFD978",
  pink: "#FF5C8A",
  live: "#FF4D6D",
};

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const KIND_THEME = {
  gift_race: { colors: ["#0B3477", "#1C5FB8", "#F6C86E"], accent: "#FFD978", icon: "trophy", unit: "kredi" },
  room_party: { colors: ["#2A0F55", "#6A2FB8", "#E0A93B"], accent: "#F6C86E", icon: "sparkles", unit: "puan" },
  love: { colors: ["#6E0F3A", "#D92D68", "#FF8FB1"], accent: "#FF5C8A", icon: "heart", unit: "kalp" },
  family_war: { colors: ["#081F45", "#1C5FB8", "#4FA3FF"], accent: "#7FB8FF", icon: "people", unit: "XP" },
};

// Katalogdaki gerçek kimlikler + olası takma adlar (SoraGiftArtwork ada göre de çözer).
const GIFT_NAME_BY_ID = {
  kraliyet_sahnesi: "Kraliyet Sahnesi",
  royal_stage: "Kraliyet Sahnesi",
  minik_kalp: "Minik Kalp",
  mini_heart: "Minik Kalp",
};

const DEFAULT_EVENT_DEFINITIONS = [
  {
    id: "weekly_gift_race",
    title: "Haftalık Hediye Yarışı",
    short_title: "Hediye Yarışı",
    subtitle: "Bu hafta en çok hediye gönderen zirveye çıkar!",
    description:
      "Hafta boyunca odalarda gönderdiğin tüm hediyelerin kredi değeri puanına eklenir. Sıralama Pazartesi 00:00'da kapanır ve ödüller otomatik dağıtılır.",
    kind: "gift_race",
    colors: KIND_THEME.gift_race.colors,
    accent: KIND_THEME.gift_race.accent,
    icon: "trophy",
    gift_id: null,
    art_gift_id: "elmas_aslan",
    rewards: [
      { rank: "1.", label: "Efsane Alev Çerçevesi 7 gün", credits: 100_000_000 },
      { rank: "2.", label: "Kehribar Çerçeve 7 gün", credits: 50_000_000 },
      { rank: "3.", label: "Kredi ödülü", credits: 25_000_000 },
      { rank: "4-10.", label: "Kredi ödülü", credits: 5_000_000 },
    ],
    rules: [
      "Herhangi bir odada dilediğin kişiye hediye gönder.",
      "Gönderdiğin her hediyenin kredi değeri kadar puan kazanırsın.",
      "Sıralama canlı güncellenir; yarış Pazartesi 00:00'da sona erer.",
      "Ödüller etkinlik bitiminden sonraki 24 saat içinde hesabına tanımlanır.",
    ],
    sort_order: 10,
  },
  {
    id: "royal_stage_night",
    title: "Kraliyet Sahnesi Gecesi",
    short_title: "Kraliyet Gecesi",
    subtitle: "Kraliyet Sahnesi gönder, çift XP kazan!",
    description:
      "Etkinlik boyunca gönderilen her Kraliyet Sahnesi hediyesi hem gönderene hem alana çift XP kazandırır. En çok Kraliyet Sahnesi gönderenler özel ödüller kazanır.",
    kind: "room_party",
    colors: KIND_THEME.room_party.colors,
    accent: KIND_THEME.room_party.accent,
    icon: "sparkles",
    gift_id: "kraliyet_sahnesi",
    gift_name: "Kraliyet Sahnesi",
    rewards: [
      { rank: "1.", label: "Kraliyet Taç Çerçevesi 7 gün", credits: 30_000_000 },
      { rank: "2.", label: "Mor Işıltı Çerçevesi 7 gün", credits: 15_000_000 },
      { rank: "3.", label: "Sahne Yıldızı Rozeti 7 gün", credits: 7_500_000 },
      { rank: "4-10.", label: "Kredi ödülü", credits: 2_000_000 },
    ],
    rules: [
      "Hediye panelinden Kraliyet Sahnesi hediyesini seç ve gönder.",
      "Her Kraliyet Sahnesi sana ve alıcıya çift (2x) XP kazandırır.",
      "Sıralama gönderilen Kraliyet Sahnesi hediyelerine göre belirlenir.",
      "Çift XP yalnızca etkinlik süresince geçerlidir.",
    ],
    sort_order: 20,
  },
  {
    id: "love_week",
    title: "Aşk Haftası",
    short_title: "Aşk Haftası",
    subtitle: "Minik Kalp gönder, sevgini herkese göster!",
    description:
      "Bu hafta en çok kalp gönderenler Aşk Elçisi olur. Gönderdiğin her Minik Kalp sıralamadaki puanına eklenir.",
    kind: "love",
    colors: KIND_THEME.love.colors,
    accent: KIND_THEME.love.accent,
    icon: "heart",
    gift_id: "minik_kalp",
    gift_name: "Minik Kalp",
    rewards: [
      { rank: "1.", label: "Aşk Kanatları Çerçevesi 7 gün", credits: 20_000_000 },
      { rank: "2.", label: "Pembe Kalp Çerçevesi 7 gün", credits: 10_000_000 },
      { rank: "3.", label: "Aşk Elçisi Rozeti 7 gün", credits: 5_000_000 },
      { rank: "4-10.", label: "Kredi ödülü", credits: 1_000_000 },
    ],
    rules: [
      "Odalarda sevdiğin kişilere Minik Kalp hediyesi gönder.",
      "Gönderdiğin her kalp sıralamada 1 puan değerindedir.",
      "En çok kalp gönderen ilk 10 kişi ödül kazanır.",
      "Etkinlik Pazartesi 00:00'da sona erer.",
    ],
    sort_order: 30,
  },
  {
    id: "family_wars",
    title: "Aile Savaşları",
    short_title: "Aile Savaşları",
    subtitle: "Aileni topla, haftanın en güçlü ailesi olun!",
    description:
      "Aileler hafta boyunca aile XP'si için yarışır. Aile üyelerinin gönderdiği hediyeler ve odalardaki aktiflik aile XP'sini yükseltir.",
    kind: "family_war",
    colors: KIND_THEME.family_war.colors,
    accent: KIND_THEME.family_war.accent,
    icon: "people",
    gift_id: null,
    rewards: [
      { rank: "1.", label: "Şampiyon Aile Rozeti 7 gün", credits: 50_000_000 },
      { rank: "2.", label: "Gümüş Aile Rozeti 7 gün", credits: 25_000_000 },
      { rank: "3.", label: "Bronz Aile Rozeti 7 gün", credits: 10_000_000 },
      { rank: "4-10.", label: "Aile kasasına kredi", credits: 2_500_000 },
    ],
    rules: [
      "Bir aileye katıl ya da kendi aileni kur.",
      "Aile üyelerinin gönderdiği hediyeler aile XP'si kazandırır.",
      "Hafta sonunda en yüksek aile XP'sine sahip aileler ödül alır.",
      "Ödüller aile kurucusuna ve aktif üyelere dağıtılır.",
    ],
    sort_order: 40,
  },
];

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

const isHex = (value) => typeof value === "string" && HEX_RE.test(value.trim());

const withAlpha = (hex, alpha) => {
  if (!isHex(hex)) return `rgba(47,128,237,${alpha})`;
  let h = hex.trim().slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const safeIcon = (name, fallback = "sparkles") =>
  typeof name === "string" && Ionicons.glyphMap && Ionicons.glyphMap[name] ? name : fallback;

const toMs = (value) => {
  if (value == null || value === "") return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const pad2 = (n) => String(Math.max(0, Math.floor(n))).padStart(2, "0");

const formatThousands = (value) => {
  const num = Math.max(0, Math.round(Number(value) || 0));
  return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

const formatCompact = (value) => {
  const num = Math.max(0, Number(value) || 0);
  const fmt = (x) => (x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10)).replace(".", ",");
  if (num >= 1e9) return `${fmt(num / 1e9)} Mr`;
  if (num >= 1e6) return `${fmt(num / 1e6)} Mn`;
  if (num >= 1e4) return `${fmt(num / 1e3)} B`;
  return formatThousands(num);
};

const splitDuration = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
};

const formatCountdown = (ms, variant = "long") => {
  if (!(ms > 0)) return "Sona erdi";
  const { days, hours, minutes, seconds } = splitDuration(ms);
  if (variant === "short") {
    if (days > 0) return `${days}g ${hours}s`;
    if (hours > 0) return `${hours}s ${pad2(minutes)}d`;
    return `${minutes}d ${pad2(seconds)}sn`;
  }
  if (days > 0) return `${days}g ${pad2(hours)}s ${pad2(minutes)}d`;
  if (hours > 0) return `${hours}s ${pad2(minutes)}d ${pad2(seconds)}sn`;
  return `${minutes}d ${pad2(seconds)}sn`;
};

const startOfLocalWeek = (now) => {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() + 6) % 7; // Pazartesi = 0
  d.setDate(d.getDate() - diff);
  return d;
};

// ---------------------------------------------------------------------------
// Normalizasyon
// ---------------------------------------------------------------------------

function normalizeEvent(raw, base = null) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id ?? base?.id ?? "").trim();
  if (!id) return null;

  const startsAtMs = toMs(raw.starts_at ?? base?.starts_at);
  const endsAtMs = toMs(raw.ends_at ?? base?.ends_at);
  if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs) || endsAtMs <= startsAtMs) return null;

  const rawKind = String(raw.kind ?? base?.kind ?? "").trim();
  const kind = KIND_THEME[rawKind] ? rawKind : "gift_race";
  const theme = KIND_THEME[kind];

  const parsedColors = parseJsonArray(raw.colors).filter(isHex).map((c) => c.trim()).slice(0, 3);
  let colors;
  if (parsedColors.length >= 2) colors = parsedColors;
  else if (parsedColors.length === 1) colors = [BRAND.navy, parsedColors[0]];
  else colors = base?.colors?.length >= 2 ? base.colors : theme.colors;

  const accent = isHex(raw.accent) ? raw.accent.trim() : isHex(base?.accent) ? base.accent : theme.accent;

  const parsedRewards = parseJsonArray(raw.rewards)
    .map((r) => ({
      rank: String(r?.rank ?? "").trim() || "—",
      label: String(r?.label ?? "").trim(),
      credits: Math.max(0, Number(r?.credits) || 0),
    }))
    .filter((r) => r.label || r.credits > 0);
  const rewards = parsedRewards.length ? parsedRewards : base?.rewards ?? [];

  const parsedRules = parseJsonArray(raw.rules)
    .map((rule) => String(rule ?? "").trim())
    .filter(Boolean);
  const rules = parsedRules.length ? parsedRules : base?.rules ?? [];

  const giftIdRaw = raw.gift_id !== undefined ? raw.gift_id : base?.gift_id;
  const giftId = giftIdRaw ? String(giftIdRaw).trim() : null;
  const giftName = String(raw.gift_name ?? "").trim() || (giftId ? GIFT_NAME_BY_ID[giftId] : null) || base?.gift_name || null;

  const artRaw = raw.art_gift_id !== undefined && raw.art_gift_id !== null ? raw.art_gift_id : base?.art_gift_id;
  const artGiftId = artRaw ? String(artRaw).trim() : null;
  const title = String(raw.title ?? "").trim() || base?.title || "Sora Etkinliği";
  const sortOrder = Number(raw.sort_order);

  return {
    id,
    title,
    short_title: String(raw.short_title ?? "").trim() || base?.short_title || title,
    subtitle: String(raw.subtitle ?? "").trim() || base?.subtitle || "",
    description: String(raw.description ?? "").trim() || base?.description || "",
    kind,
    unit: theme.unit,
    starts_at: new Date(startsAtMs).toISOString(),
    ends_at: new Date(endsAtMs).toISOString(),
    startsAtMs,
    endsAtMs,
    accent,
    colors,
    icon: safeIcon(raw.icon ?? base?.icon, theme.icon),
    gift_id: giftId,
    gift_name: giftName,
    art_gift_id: artGiftId,
    rewards,
    rules,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : base?.sort_order ?? 100,
    active: raw.active !== false,
    isDefault: Boolean(base && raw === base),
  };
}

const isVisibleEvent = (event, nowMs) =>
  Boolean(event) && event.active !== false && event.endsAtMs > nowMs && event.startsAtMs <= nowMs + UPCOMING_WINDOW_MS;

const rankEvents = (events, nowMs = Date.now()) => {
  if (!Array.isArray(events)) return [];
  return events
    .filter((event) => event && Number.isFinite(event.startsAtMs) && Number.isFinite(event.endsAtMs))
    .filter((event) => isVisibleEvent(event, nowMs))
    .sort((a, b) => {
      const aLive = a.startsAtMs <= nowMs ? 0 : 1;
      const bLive = b.startsAtMs <= nowMs ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.endsAtMs - b.endsAtMs;
    });
};

// ---------------------------------------------------------------------------
// 6) Varsayılan etkinlikler (saf fonksiyon)
// ---------------------------------------------------------------------------

export function getDefaultEvents(now = new Date()) {
  const ref = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const start = startOfLocalWeek(ref);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 7);
  const startsAt = start.toISOString();
  const endsAt = end.toISOString();
  return DEFAULT_EVENT_DEFINITIONS.map((def) => {
    const base = { ...def, starts_at: startsAt, ends_at: endsAt, active: true };
    const normalized = normalizeEvent(base, base);
    return normalized ? { ...normalized, isDefault: true } : null;
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Veri katmanı (modül belleğinde önbellek)
// ---------------------------------------------------------------------------

let eventsCache = null; // { events, fetchedAt }
let eventsInflight = null;
const leaderboardCache = new Map(); // eventId -> { rows, fetchedAt }

async function fetchEventRows() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("app_events")
      .select("*")
      .eq("active", true)
      .order("sort_order");
    if (error || !Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

function resolveEvents(rows, nowDate = new Date()) {
  const defaults = getDefaultEvents(nowDate);
  const nowMs = nowDate.getTime();
  const defaultsById = new Map(defaults.map((event) => [event.id, event]));
  let merged = [];
  if (Array.isArray(rows) && rows.length) {
    merged = rows
      .map((row) => {
        try {
          return normalizeEvent(row, defaultsById.get(String(row?.id ?? "")) || null);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  const liveDb = rankEvents(merged, nowMs);
  return liveDb.length ? liveDb : rankEvents(defaults, nowMs);
}

function loadEvents(force = false) {
  if (!force && eventsCache && Date.now() - eventsCache.fetchedAt < EVENTS_CACHE_TTL_MS) {
    return Promise.resolve(eventsCache.events);
  }
  if (eventsInflight) return eventsInflight;
  eventsInflight = (async () => {
    let events;
    try {
      const rows = await fetchEventRows();
      events = resolveEvents(rows);
    } catch {
      events = resolveEvents(null);
    }
    eventsCache = { events, fetchedAt: Date.now() };
    return events;
  })().finally(() => {
    eventsInflight = null;
  });
  return eventsInflight;
}

const normalizeLeaderboardRow = (row, index) => {
  if (!row || typeof row !== "object") return null;
  const rank = Number(row.rank);
  const avatarUrl = typeof row.avatar_url === "string" && /^https?:\/\//i.test(row.avatar_url.trim()) ? row.avatar_url.trim() : null;
  return {
    rank: Number.isFinite(rank) && rank > 0 ? rank : index + 1,
    user_id: row.user_id != null ? String(row.user_id) : `row-${index}`,
    display_name: String(row.display_name ?? "").trim() || "Sora kullanıcısı",
    avatar_url: avatarUrl,
    avatar_color: isHex(row.avatar_color) ? row.avatar_color.trim() : null,
    score: Math.max(0, Number(row.score) || 0),
  };
};

async function fetchLeaderboard(eventId) {
  if (!eventId) return [];
  const cached = leaderboardCache.get(eventId);
  if (cached && Date.now() - cached.fetchedAt < LEADERBOARD_CACHE_TTL_MS) return cached.rows;
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_event_leaderboard", {
    p_event_id: eventId,
    p_limit: LEADERBOARD_LIMIT,
  });
  if (error) {
    throw error;
  }
  const rows = (Array.isArray(data) ? data : [])
    .map(normalizeLeaderboardRow)
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank);
  leaderboardCache.set(eventId, { rows, fetchedAt: Date.now() });
  return rows;
}

// ---------------------------------------------------------------------------
// 1) useSoraEvents
// ---------------------------------------------------------------------------

export function useSoraEvents() {
  const [state, setState] = useState(() => ({
    events: eventsCache ? eventsCache.events : rankEvents(getDefaultEvents()),
    loading: !eventsCache,
  }));
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadEvents(false)
      .then((events) => {
        if (mountedRef.current) setState({ events, loading: false });
      })
      .catch(() => {
        if (mountedRef.current) setState((prev) => ({ ...prev, loading: false }));
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (mountedRef.current) setState((prev) => (prev.loading ? prev : { ...prev, loading: true }));
    let events;
    try {
      leaderboardCache.clear();
      events = await loadEvents(true);
    } catch {
      events = rankEvents(getDefaultEvents());
    }
    if (mountedRef.current) setState({ events, loading: false });
    return events;
  }, []);

  return useMemo(() => ({ events: state.events, loading: state.loading, refresh }), [state, refresh]);
}

// ---------------------------------------------------------------------------
// 2) useEventCountdown
// ---------------------------------------------------------------------------

function useCountdownMs(target, variant = "long") {
  const targetMs = toMs(target);
  const valid = Number.isFinite(targetMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!valid) return undefined;
    let active = true;
    let timerId = null;
    const scheduleNext = () => {
      const current = Date.now();
      const rem = targetMs - current;
      if (rem <= 0) {
        if (active) setNow(current);
        return;
      }
      const needsSeconds =
        variant === "seconds"
          ? true
          : variant === "short"
            ? rem <= 3_600_000
            : rem < 86_400_000;
      const delay = needsSeconds
        ? 1000
        : Math.min(60_000, Math.max(1000, (rem % 60_000) + 120));
      timerId = setTimeout(() => {
        if (!active) return;
        setNow(Date.now());
        scheduleNext();
      }, delay);
    };
    setNow(Date.now());
    scheduleNext();
    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [targetMs, valid, variant]);

  return valid ? Math.max(0, targetMs - now) : 0;
}

export function useEventCountdown(endsAt, variant = "long") {
  const remaining = useCountdownMs(endsAt, variant);
  return formatCountdown(remaining, variant);
}

// ---------------------------------------------------------------------------
// Animasyon yardımcıları (native driver)
// ---------------------------------------------------------------------------

const floatFactory = (value) =>
  Animated.sequence([
    Animated.timing(value, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    Animated.timing(value, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
  ]);

const pulseFactory = (value) =>
  Animated.sequence([
    Animated.timing(value, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    Animated.timing(value, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
  ]);

const shimmerFactory = (value) =>
  Animated.sequence([
    Animated.timing(value, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    Animated.delay(2600),
  ]);

function useLoopAnimation(enabled, factory) {
  const valueRef = useRef(null);
  if (valueRef.current === null) valueRef.current = new Animated.Value(0);
  const value = valueRef.current;

  useEffect(() => {
    value.stopAnimation();
    value.setValue(0);
    if (!enabled) return undefined;
    const loop = Animated.loop(factory(value));
    loop.start();
    return () => {
      loop.stop();
      value.setValue(0);
    };
  }, [enabled, factory, value]);

  return value;
}

// ---------------------------------------------------------------------------
// Ortak küçük bileşenler
// ---------------------------------------------------------------------------

const EventArtwork = memo(function EventArtwork({ event, size, color = "#FFFFFF" }) {
  const artId = event.gift_id || event.art_gift_id;
  if (artId || event.gift_name) {
    return (
      <SoraGiftArtwork
        giftId={artId || undefined}
        giftName={event.gift_id ? event.gift_name || undefined : undefined}
        fallbackIcon={event.icon}
        fallbackColor={color}
        size={size}
      />
    );
  }
  return (
    <View style={[styles.artIconBox, { width: size, height: size }]}>
      <Ionicons name={safeIcon(event.icon)} size={Math.round(size * 0.66)} color={color} />
    </View>
  );
});

const EventTimerText = memo(function EventTimerText({ event, variant = "long", style, withPrefix = false }) {
  const upcoming = event.startsAtMs > Date.now();
  const text = useEventCountdown(upcoming ? event.startsAtMs : event.endsAtMs, variant);
  const prefix = withPrefix ? (upcoming ? "Başlangıca: " : "Bitişe: ") : "";
  return (
    <Text style={style} numberOfLines={1}>
      {prefix}
      {text}
    </Text>
  );
});

const LiveKicker = memo(function LiveKicker({ upcoming, pulseValue, style }) {
  const ringScale = pulseValue.interpolate({ inputRange: [0, 1], outputRange: [1, 2.3] });
  const ringOpacity = pulseValue.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  const dotColor = upcoming ? BRAND.goldLight : BRAND.live;
  return (
    <View style={[styles.kickerPill, style]}>
      <View style={styles.kickerDotWrap}>
        <Animated.View
          style={[styles.kickerDotRing, { backgroundColor: dotColor, opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
        />
        <View style={[styles.kickerDot, { backgroundColor: dotColor }]} />
      </View>
      <Text style={styles.kickerText}>{upcoming ? "YAKINDA" : "CANLI ETKİNLİK"}</Text>
    </View>
  );
});

// ---------------------------------------------------------------------------
// 3) EventBannerCarousel
// ---------------------------------------------------------------------------

const BannerCard = memo(function BannerCard({ event, width, floatValue, pulseValue, sheenValue, onOpenEvent, style }) {
  const upcoming = event.startsAtMs > Date.now();
  const art = EVENT_BANNER_ART[event.kind];
  const topPrize = event.rewards?.[0]?.credits || 0;
  const artScale = floatValue.interpolate({ inputRange: [0, 1], outputRange: [1.03, 1.09] });
  const sheenX = sheenValue.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.5, width * 1.15] });

  return (
    <Pressable
      onPress={() => onOpenEvent?.(event)}
      accessibilityRole="button"
      accessibilityLabel={`${event.title}. ${event.subtitle}. Katılmak için dokun.`}
      style={({ pressed }) => [styles.bannerCard, { width }, style, pressed && styles.pressed]}
    >
      {art ? (
        <Animated.Image
          source={art}
          resizeMode="cover"
          style={[StyleSheet.absoluteFill, { transform: [{ scale: artScale }] }]}
        />
      ) : (
        <>
          <LinearGradient colors={event.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View pointerEvents="none" style={styles.bannerArtFallback}>
            <EventArtwork event={event} size={78} />
          </View>
        </>
      )}
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(8,4,20,0.86)", "rgba(8,4,20,0.5)", "rgba(8,4,20,0)"]}
        locations={[0, 0.42, 0.72]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(8,4,20,0)", "rgba(8,4,20,0.5)"]}
        start={{ x: 0.5, y: 0.45 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View pointerEvents="none" style={[styles.bannerSheen, { transform: [{ translateX: sheenX }] }]}>
        <LinearGradient
          colors={["rgba(255,240,200,0)", "rgba(255,240,200,0.28)", "rgba(255,240,200,0)"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.bannerSheenBand}
        />
      </Animated.View>
      <View pointerEvents="none" style={styles.bannerEdge} />

      <View style={styles.bannerHead}>
        <LiveKicker upcoming={upcoming} pulseValue={pulseValue} />
        <Text style={styles.bannerTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {event.short_title || event.title}
        </Text>
      </View>
      <View style={styles.bannerFooter}>
        <View style={styles.countdownChip}>
          <View style={styles.countdownDot} />
          <EventTimerText event={event} variant="long" style={styles.countdownChipText} />
        </View>
        {topPrize > 0 ? (
          <View style={[styles.countdownChip, styles.prizeChip]}>
            <LinearGradient colors={GOLD_BUTTON} style={styles.prizeCoin} />
            <Text style={styles.prizeText} numberOfLines={1}>{formatCompact(topPrize)}</Text>
          </View>
        ) : null}
        <LinearGradient colors={GOLD_BUTTON} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.ctaGold}>
          <Text style={styles.ctaGoldText}>Katıl</Text>
        </LinearGradient>
      </View>
    </Pressable>
  );
});

export const EventBannerCarousel = memo(function EventBannerCarousel({ events, onOpenEvent, style }) {
  const { width: windowWidth } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const list = useMemo(() => rankEvents(events), [events]);
  const count = list.length;
  const [containerWidth, setContainerWidth] = useState(0);
  const cardWidth = Math.max(240, Math.round(containerWidth || (windowWidth - 36)));
  const interval = cardWidth + CARD_GAP;
  const scrollRef = useRef(null);
  const [index, setIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const safeIndex = count ? Math.min(index, count - 1) : 0;
  const handleContainerLayout = useCallback((e) => {
    const w = Math.round(e?.nativeEvent?.layout?.width || 0);
    if (w > 120) setContainerWidth((prev) => (prev === w ? prev : w));
  }, []);

  const floatValue = useLoopAnimation(!reducedMotion && count > 0, floatFactory);
  const pulseValue = useLoopAnimation(!reducedMotion && count > 0, pulseFactory);
  const sheenValue = useLoopAnimation(!reducedMotion && count > 0, shimmerFactory);

  useEffect(() => {
    if (count <= 1 || dragging || reducedMotion) return undefined;
    const timer = setTimeout(() => {
      const next = (safeIndex + 1) % count;
      scrollRef.current?.scrollTo({ x: next * interval, y: 0, animated: true });
      setIndex(next);
    }, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [count, dragging, reducedMotion, safeIndex, interval]);

  const handleBeginDrag = useCallback(() => setDragging(true), []);
  const handleEndDrag = useCallback(() => setDragging(false), []);
  const handleMomentumEnd = useCallback(
    (e) => {
      const x = e?.nativeEvent?.contentOffset?.x ?? 0;
      const next = Math.max(0, Math.min(count - 1, Math.round(x / interval)));
      setIndex(next);
      setDragging(false);
    },
    [count, interval],
  );

  const jumpTo = useCallback(
    (i) => {
      scrollRef.current?.scrollTo({ x: i * interval, y: 0, animated: !reducedMotion });
      setIndex(i);
    },
    [interval, reducedMotion],
  );

  if (!count) return null;

  const activeColor = list[safeIndex]?.colors?.[1] || BRAND.blue;

  return (
    <View style={[styles.carouselRoot, style]} onLayout={handleContainerLayout}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        contentContainerStyle={styles.carouselContent}
        onScrollBeginDrag={handleBeginDrag}
        onScrollEndDrag={handleEndDrag}
        onMomentumScrollEnd={handleMomentumEnd}
        scrollEventThrottle={32}
      >
        {list.map((event, i) => (
          <BannerCard
            key={event.id}
            event={event}
            width={cardWidth}
            floatValue={floatValue}
            pulseValue={pulseValue}
            sheenValue={sheenValue}
            onOpenEvent={onOpenEvent}
            style={i < count - 1 ? styles.carouselGap : null}
          />
        ))}
      </ScrollView>
      {count > 1 ? (
        <View style={styles.dotsRow}>
          {list.map((event, i) => (
            <Pressable
              key={event.id}
              onPress={() => jumpTo(i)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`${i + 1}. etkinlik`}
            >
              <View style={[styles.dot, i === safeIndex && styles.dotActive, i === safeIndex && { backgroundColor: activeColor }]} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
});

// ---------------------------------------------------------------------------
// 4) RoomEventCard
// ---------------------------------------------------------------------------

export const RoomEventCard = memo(function RoomEventCard({
  events,
  onOpenEvent,
  style,
  compact = true,
  variant = "card",
}) {
  const reducedMotion = useReducedMotion();
  const list = useMemo(() => rankEvents(events), [events]);
  const count = list.length;
  const [index, setIndex] = useState(0);
  const safeIndex = count ? index % count : 0;
  const fade = useRef(new Animated.Value(1)).current;
  const mountedRef = useRef(true);
  const isStrip = variant === "strip";
  const isPoster = variant === "poster";

  const cardWidth = isPoster ? 68 : compact ? 116 : 156;
  const cardHeight = isPoster ? 76 : isStrip ? 42 : compact ? 50 : 62;

  const shimmer = useLoopAnimation(!reducedMotion && count > 0, shimmerFactory);
  const glow = useLoopAnimation(!reducedMotion && count > 0, pulseFactory);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      fade.stopAnimation();
    };
  }, [fade]);

  // Rotasyon: 6 sn'de bir sonraki etkinliğe fade ile geç.
  useEffect(() => {
    if (count <= 1) return undefined;
    let anim = null;
    let done = false;
    const timer = setTimeout(() => {
      if (reducedMotion) {
        setIndex((i) => (i + 1) % count);
        return;
      }
      anim = Animated.timing(fade, { toValue: 0, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true });
      anim.start(({ finished }) => {
        if (!finished || !mountedRef.current) return;
        done = true;
        setIndex((i) => (i + 1) % count);
      });
    }, ROOM_ROTATE_MS);
    return () => {
      clearTimeout(timer);
      if (anim && !done) {
        anim.stop();
        fade.setValue(1);
      }
    };
  }, [count, safeIndex, reducedMotion, fade]);

  useEffect(() => {
    if (reducedMotion) {
      fade.setValue(1);
      return undefined;
    }
    const anim = Animated.timing(fade, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [safeIndex, reducedMotion, fade]);

  if (!count) return null;
  const event = list[safeIndex];
  const upcoming = event.startsAtMs > Date.now();

  const shimmerSpan = isStrip ? 260 : cardWidth;
  const shimmerX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-48, shimmerSpan + 24] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.14, 0.34] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });

  if (isPoster) {
    return (
      <Pressable
        onPress={() => onOpenEvent?.(event)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${event.title} etkinliğini aç`}
        style={({ pressed }) => [styles.roomPosterWrap, style, pressed && styles.pressed]}
      >
        <View style={{ width: cardWidth, height: cardHeight }}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.roomGlow,
              { borderRadius: 14, backgroundColor: withAlpha(event.accent, 0.48), opacity: glowOpacity, transform: [{ scale: glowScale }] },
            ]}
          />
          <Animated.View style={[styles.roomCard, styles.roomCardPoster, { opacity: fade }]}>
            <LinearGradient colors={event.colors} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(6,10,20,0.42)", "rgba(6,10,20,0.06)", "rgba(6,10,20,0.68)"]}
              locations={[0, 0.48, 1]}
              style={StyleSheet.absoluteFill}
            />
            {!reducedMotion ? (
              <Animated.View pointerEvents="none" style={[styles.roomShimmer, { transform: [{ translateX: shimmerX }, { rotate: "18deg" }] }]}>
                <LinearGradient
                  colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.42)", "rgba(255,255,255,0)"]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            ) : null}
            <View style={styles.roomPosterTop}>
              <Text style={styles.roomPosterTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.76}>
                {event.short_title || event.title}
              </Text>
              <View style={[styles.roomPosterLiveDot, upcoming && styles.roomLiveDotUpcoming]} />
            </View>
            <View style={styles.roomPosterArt}>
              <EventArtwork event={event} size={34} />
            </View>
            <View style={styles.roomPosterFooter}>
              <Ionicons name="time" size={8.5} color={BRAND.goldLight} />
              <EventTimerText event={event} variant="short" style={styles.roomPosterTimer} />
            </View>
          </Animated.View>
        </View>
        {count > 1 ? (
          <View style={styles.roomPosterDots} pointerEvents="none">
            {list.map((item, i) => (
              <View
                key={item.id}
                style={[styles.roomPosterDot, i === safeIndex && styles.roomPosterDotActive]}
              />
            ))}
          </View>
        ) : null}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => onOpenEvent?.(event)}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`${event.title} etkinliğini aç`}
      style={({ pressed }) => [
        styles.roomRoot,
        isStrip ? { flex: 1, height: cardHeight } : { width: cardWidth, height: cardHeight },
        style,
        pressed && styles.pressed,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.roomGlow,
          isStrip && { borderRadius: 15 },
          { backgroundColor: withAlpha(event.accent, 0.44), opacity: glowOpacity, transform: [{ scale: glowScale }] },
        ]}
      />
      <Animated.View style={[styles.roomCard, isStrip && styles.roomCardStrip, { opacity: fade }]}>
        <LinearGradient colors={event.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(8,14,26,0.44)", "rgba(8,14,26,0.08)"]}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        {!reducedMotion ? (
          <Animated.View pointerEvents="none" style={[styles.roomShimmer, { transform: [{ translateX: shimmerX }, { rotate: "18deg" }] }]}>
            <LinearGradient
              colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.4)", "rgba(255,255,255,0)"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : null}
        {isStrip ? (
          <View style={styles.roomStripRow}>
            <View style={styles.roomStripIconWrap}>
              <EventArtwork event={event} size={22} />
            </View>
            <View style={styles.roomTextCol}>
              <View style={styles.roomStripMetaRow}>
                <View style={[styles.roomLiveDot, upcoming && styles.roomLiveDotUpcoming]} />
                <Text style={styles.roomStripBadgeText} numberOfLines={1}>
                  {upcoming ? "YAKINDA" : "ETKİNLİK"}
                </Text>
                <Text style={styles.roomStripDotSep}>·</Text>
                <Ionicons name="time" size={9.5} color={BRAND.goldLight} />
                <EventTimerText event={event} variant="short" style={styles.roomStripTimerText} />
              </View>
              <Text style={styles.roomStripTitle} numberOfLines={1}>
                {event.short_title || event.title}
              </Text>
            </View>
            <View style={styles.roomStripRight}>
              {count > 1 ? (
                <View style={styles.roomStripDots} pointerEvents="none">
                  {list.map((item, i) => (
                    <View key={item.id} style={[styles.roomDot, i === safeIndex && styles.roomDotActive]} />
                  ))}
                </View>
              ) : null}
              <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.82)" />
            </View>
          </View>
        ) : (
          <>
            <View style={[styles.roomRow, !compact && styles.roomRowLarge]}>
              <View style={[styles.roomIconWrap, !compact && styles.roomIconWrapLarge]}>
                <EventArtwork event={event} size={compact ? 21 : 30} />
              </View>
              <View style={styles.roomTextCol}>
                <View style={styles.roomLiveRow}>
                  <View style={[styles.roomLiveDot, upcoming && styles.roomLiveDotUpcoming]} />
                  <Text style={styles.roomLiveText} numberOfLines={1}>
                    {upcoming ? "YAKINDA" : "ETKİNLİK"}
                  </Text>
                </View>
                <Text
                  style={[styles.roomTitle, !compact && styles.roomTitleLarge]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                >
                  {compact ? event.short_title : event.title}
                </Text>
                <View style={styles.roomTimerRow}>
                  <Ionicons name="time" size={compact ? 9 : 10} color={BRAND.goldLight} />
                  <EventTimerText event={event} variant="short" style={[styles.roomTimerText, !compact && styles.roomTimerTextLarge]} />
                </View>
              </View>
            </View>
            {count > 1 ? (
              <View style={styles.roomDots} pointerEvents="none">
                {list.map((item, i) => (
                  <View key={item.id} style={[styles.roomDot, i === safeIndex && styles.roomDotActive]} />
                ))}
              </View>
            ) : null}
          </>
        )}
      </Animated.View>
    </Pressable>
  );
});

// ---------------------------------------------------------------------------
// 5) EventDetailSheet
// ---------------------------------------------------------------------------

function useEventLeaderboard(eventId, enabled) {
  const [state, setState] = useState({ rows: [], loading: false, error: false });
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!enabled || !eventId) return undefined;
    let cancelled = false;
    const cached = leaderboardCache.get(eventId);
    setState({ rows: cached ? cached.rows : [], loading: !cached, error: false });
    fetchLeaderboard(eventId)
      .then((rows) => {
        if (!cancelled) setState({ rows, loading: false, error: false });
      })
      .catch(() => {
        if (!cancelled) {
          setState((prev) => ({
            rows: cached ? cached.rows : prev.rows,
            loading: false,
            error: !cached,
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, enabled, retryNonce]);

  const retry = useCallback(() => {
    if (eventId) leaderboardCache.delete(eventId);
    setRetryNonce((n) => n + 1);
  }, [eventId]);

  return { ...state, retry };
}

const EventAvatar = memo(function EventAvatar({ url, size = 36, ringColor, empty = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [url]);
  const ring = ringColor ? { borderWidth: 1.5, borderColor: ringColor } : null;
  const dims = { width: size, height: size, borderRadius: size / 2 };
  if (!empty && url && !failed) {
    return <Image source={{ uri: url }} onError={() => setFailed(true)} style={[styles.avatarImage, dims, ring]} />;
  }
  const gradColors = empty ? ["#1A2C4D", "#0E1A30"] : ["#3B82F6", "#1C5FB8", "#0F2A55"];
  return (
    <LinearGradient colors={gradColors} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={[styles.avatarFallback, dims, ring]}>
      <Ionicons
        name="mic"
        size={Math.round(size * 0.44)}
        color={empty ? "rgba(255,255,255,0.48)" : "rgba(255,255,255,0.92)"}
      />
    </LinearGradient>
  );
});

const HeroCountdownChip = memo(function HeroCountdownChip({ event }) {
  const upcoming = event.startsAtMs > Date.now();
  const remaining = useCountdownMs(upcoming ? event.startsAtMs : event.endsAtMs, "seconds");
  const { days, hours, minutes, seconds } = splitDuration(remaining);
  const text =
    remaining <= 0
      ? "Sona erdi"
      : `${days > 0 ? `${days}g ` : ""}${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  return (
    <View style={[styles.heroChip, styles.heroTimerChip]}>
      <Ionicons name="time-outline" size={12.5} color="#FFFFFF" />
      <Text style={styles.heroTimerText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
});

const HeroSparkles = memo(function HeroSparkles({ pulseValue }) {
  const on = pulseValue.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.95] });
  const off = pulseValue.interpolate({ inputRange: [0, 1], outputRange: [0.95, 0.22] });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {HERO_SPARKLES.map(([left, top, size, group]) => {
        const opacity = group ? off : on;
        return (
          <Animated.View
            key={`${left}-${top}`}
            style={{ position: "absolute", left: `${left}%`, top: `${top}%`, opacity, transform: [{ scale: opacity }] }}
          >
            <MaterialCommunityIcons name="star-four-points" size={size} color="#FFF4CC" style={styles.sparkleIcon} />
          </Animated.View>
        );
      })}
    </View>
  );
});

const FramedPodiumAvatar = memo(function FramedPodiumAvatar({ row, place, scale = 1 }) {
  const f = STAGE_FRAMES[place];
  const coin = RANK_COIN_THEMES[place];
  const avSize = Math.round(f.avatar * scale);
  const fw = Math.round((avSize * 0.96) / f.hole);
  const fh = Math.round(fw * f.aspect);
  const avLeft = Math.round(f.cx * fw - avSize / 2);
  const avTop = Math.round(f.cy * fh - avSize / 2);
  return (
    <View style={{ width: fw, height: fh }}>
      <View style={{ position: "absolute", left: avLeft, top: avTop }}>
        <EventAvatar url={row?.avatar_url} size={avSize} empty={!row} />
      </View>
      <Image source={f.src} resizeMode="contain" style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={coin.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.rankCoin}
      >
        <Text style={[styles.rankCoinText, { color: coin.text }]}>{place}</Text>
      </LinearGradient>
    </View>
  );
});

const StagePodium = memo(function StagePodium({ rows, me, width, theme, pulseValue }) {
  const podH = width / PODIUM_STAGE.aspect;
  const avScale = Math.min(1, width / 328);
  const wrapH = Math.round(podH + 68 * avScale);
  const glowScale = pulseValue.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] });
  const glowOpacity = pulseValue.interpolate({ inputRange: [0, 1], outputRange: [0.48, 0.82] });
  const glowW = Math.round(width * 0.68);
  const glowH = Math.round(podH * 0.96);
  const faceW = Math.round(width * 0.295);

  return (
    <View style={[styles.podiumWrap, { width, height: wrapH }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.podiumGlow,
          {
            width: glowW,
            height: glowH,
            borderRadius: glowH / 2,
            left: (width - glowW) / 2,
            top: 8,
            backgroundColor: theme.glow,
            opacity: glowOpacity,
            transform: [{ scale: glowScale }],
          },
        ]}
      />
      <Image source={PODIUM_STAGE.src} resizeMode="contain" style={[styles.podiumArt, { width, height: podH }]} />
      {[2, 1, 3].map((place) => {
        const row = rows[place - 1] || null;
        const step = PODIUM_STAGE.steps[place];
        const cxPx = Math.round(step.cx * width);
        const isMe = Boolean(row && me && me === row.user_id);
        const frameBottom = Math.round(podH * (1 - step.top) - step.seat * avScale);
        const faceTop = Math.round(wrapH - podH * (1 - step.rim)) + 3;
        const faceH = Math.max(34, wrapH - 5 - faceTop);
        return (
          <React.Fragment key={`step-${place}`}>
            <View
              style={[
                styles.podiumAvatarSlot,
                { left: cxPx - 64, width: 128, bottom: frameBottom, zIndex: place === 1 ? 4 : 3 },
              ]}
            >
              <FramedPodiumAvatar row={row} place={place} scale={avScale} />
            </View>
            <View
              pointerEvents="none"
              style={[
                styles.podiumFace,
                { left: cxPx - faceW / 2, top: faceTop, width: faceW, height: faceH },
              ]}
            >
              <Text style={[styles.podiumName, isMe && styles.podiumNameMe]} numberOfLines={1}>
                {row ? (isMe ? "Sen" : row.display_name) : "Boş sıra"}
              </Text>
              <View style={styles.podiumScoreRow}>
                {row ? (
                  <>
                    <Ionicons name={safeIcon(theme.unitIcon, "trophy")} size={10.5} color={theme.unitColor} />
                    <Text style={styles.podiumScore} numberOfLines={1}>
                      {formatCompact(row.score)}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.podiumScoreEmpty}>—</Text>
                )}
              </View>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
});

const StageRewards = memo(function StageRewards({ rewards, currentUserAvatar, onToggleRules }) {
  if (!Array.isArray(rewards) || !rewards.length) return null;
  const isScrollable = rewards.length > 2;

  const renderCard = (reward, idx) => {
    const tier = rewardTierKey(reward.rank);
    const pill = REWARD_PILL_THEMES[tier];
    const visual = resolveRewardVisual(reward.label);
    const days = rewardDays(reward.label);
    const sub = rewardSubtitle(reward);
    const isTop = idx === 0;
    return (
      <View
        key={`rw-${idx}-${reward.rank}`}
        style={[
          styles.rewardCard,
          isScrollable ? styles.rewardCardScroll : styles.rewardCardPair,
          isTop && styles.rewardCardTop,
        ]}
      >
        {isTop ? (
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(251,191,36,0.14)", "rgba(251,191,36,0)"]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 0.72 }}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View style={styles.rewardTopRow}>
          <View style={[styles.rewardRankPill, { backgroundColor: pill.bg, borderColor: pill.border }]}>
            <Text style={[styles.rewardRankPillText, { color: pill.text }]} numberOfLines={1}>
              {reward.rank}
            </Text>
          </View>
          {days ? (
            <View style={styles.rewardDaysPill}>
              <Text style={styles.rewardDaysText} numberOfLines={1}>
                {days}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.rewardArtBox}>
          <View style={[styles.rewardArtGlow, { backgroundColor: withAlpha(visual.glow, 0.24) }]} />
          {visual.isFrame ? (
            <View style={styles.rewardFrameAvatar}>
              <EventAvatar url={currentUserAvatar} size={36} />
            </View>
          ) : null}
          <Image source={visual.source} resizeMode="contain" style={styles.rewardArtImg} />
        </View>

        <Text style={styles.rewardVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {reward.credits > 0 ? `${formatCompact(reward.credits)} kredi` : "Özel ödül"}
        </Text>
        <Text style={styles.rewardSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Ödüller</Text>
        {onToggleRules ? (
          <Pressable onPress={onToggleRules} hitSlop={8} accessibilityRole="button" style={styles.sectionLinkBtn}>
            <Text style={styles.sectionLinkText}>Kurallar</Text>
            <Ionicons name="chevron-forward" size={13} color="#60A5FA" />
          </Pressable>
        ) : null}
      </View>
      {isScrollable ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rewardScrollContent}
          style={styles.rewardScrollOuter}
        >
          {rewards.map(renderCard)}
        </ScrollView>
      ) : (
        <View style={styles.rewardPairRow}>{rewards.map(renderCard)}</View>
      )}
    </View>
  );
});

const LeaderboardRow = memo(function LeaderboardRow({ row, isMe, unitIcon, unitColor, unrankedLabel = null }) {
  return (
    <View style={[styles.lbRow, isMe && styles.lbRowMe]}>
      <Text style={[styles.lbRankText, isMe && styles.lbRankTextMe]} numberOfLines={1}>
        {unrankedLabel ? "—" : row.rank}
      </Text>
      <EventAvatar
        url={row.avatar_url}
        size={34}
        ringColor={isMe ? "rgba(96,165,250,0.65)" : "rgba(255,255,255,0.16)"}
      />
      <View style={styles.lbNameCol}>
        <Text style={styles.lbName} numberOfLines={1}>
          {row.display_name}
        </Text>
        {isMe ? (
          <View style={styles.meBadge}>
            <Text style={styles.meBadgeText}>SEN</Text>
          </View>
        ) : null}
      </View>
      {unrankedLabel ? (
        <Text style={styles.lbUnrankedText}>{unrankedLabel}</Text>
      ) : (
        <View style={styles.lbScoreWrap}>
          <Text style={styles.lbScore} numberOfLines={1}>
            {formatThousands(row.score)}
          </Text>
          <Ionicons name={safeIcon(unitIcon, "trophy")} size={12.5} color={unitColor} style={styles.lbIcon} />
        </View>
      )}
    </View>
  );
});

const StageLeaderboard = memo(function StageLeaderboard({
  event,
  enabled,
  currentUserId,
  currentUserAvatar,
  currentUserName,
  stageWidth,
  theme,
  pulseValue,
  rewardsNode,
}) {
  const { rows, loading, error, retry } = useEventLeaderboard(event.id, enabled);
  const me = currentUserId ? String(currentUserId) : null;
  const userInRows = useMemo(() => Boolean(me && rows.some((r) => r.user_id === me)), [me, rows]);
  const rest = rows.slice(3);

  if (loading) {
    return (
      <View>
        <View style={styles.stateBox}>
          <ActivityIndicator color="#FFD978" />
          <Text style={styles.stateSub}>Sıralama yükleniyor…</Text>
        </View>
        {rewardsNode}
      </View>
    );
  }

  if (error && rows.length === 0) {
    return (
      <View>
        <Pressable onPress={retry} accessibilityRole="button" style={styles.stateBox}>
          <View style={styles.stateOrb}>
            <Ionicons name="cloud-offline-outline" size={22} color="#FFD978" />
          </View>
          <Text style={styles.stateTitle}>Sıralama yüklenemedi</Text>
          <Text style={styles.stateSub}>Tekrar denemek için dokun.</Text>
        </Pressable>
        {rewardsNode}
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View>
        <View style={styles.stateBox}>
          <View style={styles.stateOrb}>
            <Ionicons name={safeIcon(theme.unitIcon, "trophy")} size={22} color="#FFD978" />
          </View>
          <Text style={styles.stateTitle}>İlk sırayı sen kap!</Text>
          <Text style={styles.stateSub}>Henüz sıralama oluşmadı. İlk hediyeyi gönder, zirveye yerleş.</Text>
        </View>
        {rewardsNode}
      </View>
    );
  }

  return (
    <View>
      {stageWidth > 0 ? (
        <StagePodium
          rows={rows.slice(0, 3)}
          me={me}
          width={stageWidth}
          theme={theme}
          pulseValue={pulseValue}
        />
      ) : null}
      {rewardsNode}
      {rest.length > 0 || (me && !userInRows) ? (
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Sıralama</Text>
            <View style={styles.sectionMetaPill}>
              <Text style={styles.sectionMetaText}>İlk {LEADERBOARD_LIMIT} · Canlı</Text>
            </View>
          </View>
          <View style={styles.lbList}>
            {rest.map((row) => (
              <LeaderboardRow
                key={`${row.user_id}-${row.rank}`}
                row={row}
                isMe={Boolean(me && me === row.user_id)}
                unitIcon={theme.unitIcon}
                unitColor={theme.unitColor}
              />
            ))}
            {me && !userInRows ? (
              <LeaderboardRow
                key="self-unranked"
                row={{
                  rank: 0,
                  user_id: me,
                  display_name: currentUserName || "Sen",
                  avatar_url: currentUserAvatar || null,
                  score: 0,
                }}
                isMe
                unrankedLabel={rows.length >= LEADERBOARD_LIMIT ? `İlk ${LEADERBOARD_LIMIT} dışında` : "Henüz puanın yok"}
                unitIcon={theme.unitIcon}
                unitColor={theme.unitColor}
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
});

export const EventDetailSheet = memo(function EventDetailSheet({
  visible,
  event,
  currentUserId,
  currentUserAvatar = null,
  currentUserName = null,
  onDismiss,
  onSendGift,
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const sheetHeight = Math.round(windowHeight * 0.86);

  // Kapanış animasyonu sırasında içerik kaybolmasın diye son etkinliği tut.
  const lastEventRef = useRef(null);
  if (event) lastEventRef.current = event;
  const shownEvent = event || lastEventRef.current;

  const [mounted, setMounted] = useState(Boolean(visible && shownEvent));
  const [infoOpen, setInfoOpen] = useState(false);
  const [bodyWidth, setBodyWidth] = useState(() => Math.max(260, Math.min(windowWidth - 32, 396)));
  const progress = useRef(new Animated.Value(visible && shownEvent ? 1 : 0)).current;
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef(null);

  const floatValue = useLoopAnimation(mounted && !reducedMotion, floatFactory);
  const pulseValue = useLoopAnimation(mounted && !reducedMotion, pulseFactory);
  const sheenValue = useLoopAnimation(mounted && !reducedMotion, shimmerFactory);

  const toggleInfo = useCallback(() => {
    setInfoOpen((prev) => {
      const next = !prev;
      if (next && scrollRef.current?.scrollTo) {
        scrollRef.current.scrollTo({ y: 0, animated: !reducedMotion });
      }
      return next;
    });
  }, [reducedMotion]);

  const handleBodyLayout = useCallback((e) => {
    const w = Math.round((e?.nativeEvent?.layout?.width || 0) - 32);
    if (w >= 240) setBodyWidth((prev) => (prev === w ? prev : Math.min(w, 420)));
  }, []);

  useEffect(() => {
    if (!visible) return;
    setInfoOpen(false);
    scrollY.setValue(0);
    if (scrollRef.current?.scrollTo) {
      scrollRef.current.scrollTo({ y: 0, animated: false });
    }
  }, [shownEvent?.id, visible, scrollY]);

  useEffect(() => {
    let anim = null;
    if (visible && shownEvent) {
      setMounted(true);
      anim = Animated.timing(progress, {
        toValue: 1,
        duration: reducedMotion ? 0 : 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      anim.start();
    } else {
      anim = Animated.timing(progress, {
        toValue: 0,
        duration: reducedMotion ? 0 : 210,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      });
      anim.start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    return () => anim?.stop();
  }, [visible, shownEvent, progress, reducedMotion]);

  const handleDismiss = useCallback(() => {
    onDismiss?.();
  }, [onDismiss]);

  const handleCta = useCallback(() => {
    if (typeof onSendGift === "function" && shownEvent) onSendGift(shownEvent);
    else onDismiss?.();
  }, [onSendGift, onDismiss, shownEvent]);

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
      }),
    [scrollY],
  );

  if (!shownEvent || !mounted) return null;

  const ev = shownEvent;
  const theme = EVENT_STAGE_THEME[ev.kind] || EVENT_STAGE_THEME.gift_race;
  const heroArt = EVENT_BANNER_ART[ev.kind];
  const upcoming = ev.startsAtMs > Date.now();
  const rewards = Array.isArray(ev.rewards) ? ev.rewards : [];
  const rules = Array.isArray(ev.rules) ? ev.rules : [];
  const hasRules = rules.length > 0 || Boolean(ev.description);
  const topPrize = rewards[0]?.credits || 0;
  const bottomPad = Math.max(insets.bottom, 12);
  const ctaLabel = ev.gift_name ? `${ev.gift_name} Gönder` : theme.defaultCta;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [sheetHeight, 0] });
  const heroScale = floatValue.interpolate({ inputRange: [0, 1], outputRange: [1.02, 1.06] });
  const heroParallaxY = scrollY.interpolate({
    inputRange: [-60, 0, HERO_HEIGHT],
    outputRange: [-18, 0, 52],
    extrapolate: "clamp",
  });
  const stickyBarOpacity = scrollY.interpolate({
    inputRange: [108, 162],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const ctaSheenX = sheenValue.interpolate({ inputRange: [0, 1], outputRange: [-120, windowWidth + 80] });

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={handleDismiss}>
      <View style={styles.modalRoot}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} accessibilityLabel="Kapat" />
        </Animated.View>

        <Animated.View
          onLayout={handleBodyLayout}
          style={[styles.sheet, { height: sheetHeight, backgroundColor: STAGE_BASE, transform: [{ translateY }] }]}
        >
          {/* Sabit üst bar: kaydırılınca koyu başlık şeridi belirir, butonlar sabit kalır */}
          <View pointerEvents="box-none" style={styles.stageTopBar}>
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.stageTopBarBg, { opacity: stickyBarOpacity }]} />
            <View pointerEvents="none" style={styles.stageGrabber} />
            <Animated.View pointerEvents="none" style={[styles.stageTopBarTitleWrap, { opacity: stickyBarOpacity }]}>
              <Text numberOfLines={1} style={styles.stageTopBarTitle}>
                {ev.short_title || ev.title}
              </Text>
            </Animated.View>
            {hasRules ? (
              <Pressable
                onPress={toggleInfo}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityState={{ expanded: infoOpen }}
                accessibilityLabel="Etkinlik kuralları"
                style={({ pressed }) => [styles.stageHeaderBtn, styles.stageHeaderBtnLeft, pressed && styles.pressed]}
              >
                <Ionicons name={infoOpen ? "chevron-up" : "information"} size={18} color="#FFFFFF" />
              </Pressable>
            ) : null}
            <Pressable
              onPress={handleDismiss}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Kapat"
              style={({ pressed }) => [styles.stageHeaderBtn, styles.stageHeaderBtnRight, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={19} color="#FFFFFF" />
            </Pressable>
          </View>

          <Animated.ScrollView
            ref={scrollRef}
            style={styles.body}
            contentContainerStyle={{ paddingBottom: bottomPad + 86 }}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onScroll}
          >
            {/* A) Hero: Keşfet'teki onaylı sinematik sahnenin büyümüş devamı */}
            <View style={styles.heroWrap}>
              {heroArt ? (
                <Animated.Image
                  source={heroArt}
                  resizeMode="cover"
                  style={[
                    StyleSheet.absoluteFill,
                    { transform: [{ translateY: heroParallaxY }, { scale: heroScale }] },
                  ]}
                />
              ) : (
                <LinearGradient colors={ev.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              )}
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(6,10,22,0.90)", "rgba(6,10,22,0.54)", "rgba(6,10,22,0)"]}
                locations={[0, 0.44, 0.74]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(6,10,22,0.48)", "rgba(6,10,22,0)"]}
                style={styles.heroTopScrim}
              />
              <LinearGradient
                pointerEvents="none"
                colors={[withAlpha(theme.stageTop, 0), withAlpha(theme.stageTop, 0.82), theme.stageTop]}
                locations={[0, 0.72, 1]}
                style={styles.heroBottomFade}
              />
              {!reducedMotion ? <HeroSparkles pulseValue={pulseValue} /> : null}

              <View style={styles.heroTextCol}>
                <LiveKicker upcoming={upcoming} pulseValue={pulseValue} />
                <Text style={styles.heroTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                  {ev.short_title || ev.title}
                </Text>
                <View style={styles.heroChipsRow}>
                  <HeroCountdownChip event={ev} />
                  {topPrize > 0 ? (
                    <View style={[styles.heroChip, styles.heroPrizeChip]}>
                      <LinearGradient colors={GOLD_BUTTON} style={styles.heroPrizeCoin} />
                      <Text style={styles.heroPrizeText} numberOfLines={1}>
                        {formatCompact(topPrize)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>

            {/* B) Sora Gece Vitrini gövdesi */}
            <View style={styles.stageBody}>
              <LinearGradient
                pointerEvents="none"
                colors={[theme.stageTop, STAGE_BASE, "#0E192E", STAGE_BASE]}
                locations={[0, 0.34, 0.72, 1]}
                style={StyleSheet.absoluteFill}
              />

              {infoOpen && hasRules ? (
                <View style={styles.rulesCard}>
                  <Text style={styles.rulesTitle}>Etkinlik Kuralları</Text>
                  {rules.length > 0 ? (
                    rules.map((rule, i) => (
                      <View key={`rule-${i}`} style={styles.ruleRow}>
                        <View style={styles.ruleDot} />
                        <Text style={styles.ruleText}>{rule}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.ruleText}>{ev.description}</Text>
                  )}
                </View>
              ) : null}

              <StageLeaderboard
                event={ev}
                enabled={mounted}
                currentUserId={currentUserId}
                currentUserAvatar={currentUserAvatar}
                currentUserName={currentUserName}
                stageWidth={bodyWidth}
                theme={theme}
                pulseValue={pulseValue}
                rewardsNode={
                  <StageRewards
                    rewards={rewards}
                    currentUserAvatar={currentUserAvatar}
                    onToggleRules={hasRules ? toggleInfo : null}
                  />
                }
              />
            </View>
          </Animated.ScrollView>

          {/* C) Sabit CTA bar — Android overflow uyumlu çift katmanlı 3D hediye butonu */}
          <View style={[styles.ctaBar, { paddingBottom: bottomPad + 4 }]}>
            <LinearGradient
              pointerEvents="none"
              colors={[withAlpha(STAGE_BASE, 0), withAlpha(STAGE_BASE, 0.94), STAGE_BASE]}
              locations={[0, 0.34, 1]}
              style={StyleSheet.absoluteFill}
            />
            <Pressable
              onPress={handleCta}
              accessibilityRole="button"
              accessibilityLabel={ctaLabel}
              style={({ pressed }) => [styles.ctaOuter, pressed && styles.pressed]}
            >
              <View style={[styles.ctaInner, { shadowColor: theme.ctaShadow }]}>
                <LinearGradient
                  colors={theme.ctaColors}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={StyleSheet.absoluteFill}
                />
                <LinearGradient
                  pointerEvents="none"
                  colors={["rgba(255,255,255,0.26)", "rgba(255,255,255,0)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.ctaGloss}
                />
                {!reducedMotion ? (
                  <Animated.View pointerEvents="none" style={[styles.ctaSheen, { transform: [{ translateX: ctaSheenX }] }]}>
                    <LinearGradient
                      colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.34)", "rgba(255,255,255,0)"]}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={styles.ctaSheenBand}
                    />
                  </Animated.View>
                ) : null}
                <View pointerEvents="none" style={styles.ctaRim} />
                <Text style={styles.ctaText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.84}>
                  {ctaLabel}
                </Text>
              </View>
              <View pointerEvents="none" style={styles.ctaIconFloat}>
                <Image source={theme.ctaIcon} resizeMode="contain" style={styles.ctaIconImg} />
              </View>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
});

// ---------------------------------------------------------------------------
// Stiller
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  pressed: { opacity: 0.92, transform: [{ scale: 0.98 }] },
  artIconBox: { alignItems: "center", justifyContent: "center" },

  // Kicker
  kickerPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(16,24,32,0.38)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  kickerDotWrap: { width: 8, height: 8, marginRight: 6, alignItems: "center", justifyContent: "center" },
  kickerDotRing: { position: "absolute", width: 8, height: 8, borderRadius: 4 },
  kickerDot: { width: 6, height: 6, borderRadius: 3 },
  kickerText: { color: "#FFFFFF", fontSize: 9.5, fontWeight: "900", letterSpacing: 1.1 },

  // Carousel
  carouselRoot: { width: "100%" },
  carouselContent: { paddingHorizontal: 0, paddingVertical: 3 },
  carouselGap: { marginRight: 0 },
  bannerCard: {
    height: BANNER_HEIGHT,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: BRAND.navy,
    shadowColor: "#0B1E3F",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  bannerArtFallback: { position: "absolute", right: 14, top: 0, bottom: 0, justifyContent: "center" },
  bannerSheen: { position: "absolute", top: -20, bottom: -20, left: 0, width: 110 },
  bannerSheenBand: { flex: 1, transform: [{ skewX: "-20deg" }] },
  bannerEdge: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,225,160,0.4)",
  },
  bannerHead: { position: "absolute", left: 13, top: 12, right: "38%", alignItems: "flex-start" },
  bannerTitle: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: -0.3,
    marginTop: 7,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  bannerFooter: { position: "absolute", left: 12, right: 10, bottom: 11, flexDirection: "row", alignItems: "center" },
  countdownChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    marginRight: 6,
    flexShrink: 1,
  },
  countdownDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: BRAND.live },
  countdownChipText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800", marginLeft: 5, fontVariant: ["tabular-nums"] },
  prizeChip: { borderColor: "rgba(255,215,120,0.4)", flexShrink: 0 },
  prizeCoin: { width: 13, height: 13, borderRadius: 6.5 },
  prizeText: { color: "#FFD978", fontSize: 11, fontWeight: "900", marginLeft: 5 },
  ctaGold: {
    marginLeft: "auto",
    paddingHorizontal: 15,
    paddingVertical: 7,
    borderRadius: 999,
    shadowColor: "#F2B33D",
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  ctaGoldText: { color: "#3A2205", fontSize: 12, fontWeight: "900" },
  dotsRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, marginHorizontal: 3, backgroundColor: "rgba(28,95,184,0.22)" },
  dotActive: { width: 18, backgroundColor: BRAND.blue },

  // Oda kartı
  roomRoot: { overflow: "visible" },
  roomGlow: { position: "absolute", top: -1.5, left: -1.5, right: -1.5, bottom: -1.5, borderRadius: 14 },
  roomCard: {
    flex: 1,
    borderRadius: 13,
    overflow: "hidden",
    borderWidth: 1.1,
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: BRAND.navy,
  },
  roomShimmer: { position: "absolute", top: -20, bottom: -20, width: 32, left: 0 },
  roomRow: { flex: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 7 },
  roomRowLarge: { paddingHorizontal: 9 },
  roomIconWrap: {
    width: 27,
    height: 27,
    borderRadius: 13.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    marginRight: 6,
  },
  roomIconWrapLarge: { width: 40, height: 40, borderRadius: 20, marginRight: 8 },
  roomTextCol: { flex: 1, minWidth: 0, justifyContent: "center" },
  roomLiveRow: { flexDirection: "row", alignItems: "center" },
  roomLiveDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: BRAND.live, marginRight: 3 },
  roomLiveDotUpcoming: { backgroundColor: BRAND.goldLight },
  roomLiveText: { color: "rgba(255,255,255,0.78)", fontSize: 7.5, fontWeight: "900", letterSpacing: 0.8 },
  roomTitle: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
    marginTop: 1,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  roomTitleLarge: { fontSize: 13 },
  roomTimerRow: { flexDirection: "row", alignItems: "center", marginTop: 1 },
  roomTimerText: { color: BRAND.goldLight, fontSize: 9.5, fontWeight: "800", marginLeft: 2, fontVariant: ["tabular-nums"] },
  roomTimerTextLarge: { fontSize: 11 },
  roomDots: { position: "absolute", right: 6, bottom: 4, flexDirection: "row" },
  roomDot: { width: 3, height: 3, borderRadius: 1.5, marginLeft: 2, backgroundColor: "rgba(255,255,255,0.4)" },
  roomDotActive: { backgroundColor: "#FFFFFF" },
  roomCardStrip: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
  },
  roomStripRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 8,
    paddingRight: 9,
  },
  roomStripIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    marginRight: 8,
  },
  roomStripMetaRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  roomStripBadgeText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 8.5,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  roomStripDotSep: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 9,
    marginHorizontal: 4,
    fontWeight: "800",
  },
  roomStripTimerText: {
    color: BRAND.goldLight,
    fontSize: 9.5,
    fontWeight: "800",
    marginLeft: 2.5,
    fontVariant: ["tabular-nums"],
  },
  roomStripTitle: {
    color: "#FFFFFF",
    fontSize: 12.5,
    fontWeight: "900",
    marginTop: 0.5,
    textShadowColor: "rgba(0,0,0,0.32)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  roomStripRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginLeft: 6,
  },
  roomStripDots: {
    flexDirection: "row",
    alignItems: "center",
  },
  roomPosterWrap: {
    alignItems: "center",
    overflow: "visible",
  },
  roomCardPoster: {
    borderRadius: 13,
    borderWidth: 1.1,
    borderColor: "rgba(255,255,255,0.3)",
    justifyContent: "space-between",
    paddingTop: 5,
    paddingBottom: 4,
    paddingHorizontal: 4,
  },
  roomPosterTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
    gap: 3,
  },
  roomPosterTitle: {
    color: "#FFFFFF",
    fontSize: 8.5,
    fontWeight: "900",
    textAlign: "center",
    flexShrink: 1,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  roomPosterLiveDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.25,
    backgroundColor: BRAND.live,
  },
  roomPosterArt: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  roomPosterFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 7,
    backgroundColor: "rgba(8,14,26,0.58)",
    alignSelf: "center",
    gap: 2,
  },
  roomPosterTimer: {
    color: BRAND.goldLight,
    fontSize: 8.5,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  roomPosterDots: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    marginTop: 4,
  },
  roomPosterDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  roomPosterDotActive: {
    width: 9,
    backgroundColor: "#FFFFFF",
  },

  // Sheet — Sora Gece Vitrini (Banner devamı + Liderlik Podyumu laciverti)
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { backgroundColor: "rgba(5,10,20,0.62)" },
  sheet: {
    width: "100%",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: "hidden",
  },
  body: { flex: 1 },

  // Sabit üst bar
  stageTopBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 56,
    zIndex: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  stageTopBarBg: {
    backgroundColor: "rgba(10,17,32,0.95)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  stageGrabber: {
    position: "absolute",
    top: 7,
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.58)",
  },
  stageTopBarTitleWrap: {
    marginTop: 6,
    maxWidth: "62%",
    alignItems: "center",
  },
  stageTopBarTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  stageHeaderBtn: {
    position: "absolute",
    top: 12,
    width: 36,
    height: 36,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(9,18,30,0.56)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  stageHeaderBtnLeft: { left: 14 },
  stageHeaderBtnRight: { right: 14 },

  // Hero (Keşfet banner devamı)
  heroWrap: {
    width: "100%",
    height: HERO_HEIGHT,
    overflow: "hidden",
    backgroundColor: "#080E1C",
  },
  heroTopScrim: { position: "absolute", top: 0, left: 0, right: 0, height: 54 },
  heroBottomFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 68 },
  heroTextCol: {
    position: "absolute",
    left: 16,
    bottom: 16,
    maxWidth: "66%",
    zIndex: 5,
  },
  heroTitle: {
    marginTop: 6,
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 28,
    letterSpacing: -0.6,
    textShadowColor: "rgba(0,0,0,0.65)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  heroChipsRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  heroChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 25,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: "rgba(8,14,28,0.64)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  heroTimerChip: { minWidth: 100 },
  heroTimerText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  heroPrizeChip: { borderColor: "rgba(255,217,120,0.5)" },
  heroPrizeCoin: { width: 12, height: 12, borderRadius: 6 },
  heroPrizeText: { color: "#FFD978", fontSize: 11, fontWeight: "900" },
  sparkleIcon: {
    textShadowColor: "rgba(255,224,130,0.9)",
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 0 },
  },

  // Gövde
  stageBody: {
    marginTop: -4,
    paddingHorizontal: 16,
    paddingTop: 6,
    minHeight: 420,
  },

  // Kurallar çekmecesi
  rulesCard: {
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  rulesTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "900", marginBottom: 4 },
  ruleRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 6 },
  ruleDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 6, marginRight: 8, backgroundColor: BRAND.blueBright },
  ruleText: { flex: 1, color: "#CBD5E1", fontSize: 12, lineHeight: 17, fontWeight: "600" },

  // Avatarlar
  avatarImage: { backgroundColor: "#14243E" },
  avatarFallback: { alignItems: "center", justifyContent: "center" },

  // 3D Podyum
  podiumWrap: { alignSelf: "center", marginTop: 4 },
  podiumGlow: { position: "absolute" },
  podiumArt: { position: "absolute", left: 0, bottom: 0 },
  podiumAvatarSlot: { position: "absolute", alignItems: "center" },
  rankCoin: {
    position: "absolute",
    bottom: -6,
    alignSelf: "center",
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.85)",
  },
  rankCoinText: { fontSize: 10.5, fontWeight: "900" },
  podiumFace: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    zIndex: 5,
  },
  podiumName: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
    maxWidth: "100%",
    textShadowColor: "rgba(0,0,0,0.65)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  podiumNameMe: { color: "#93C5FD" },
  podiumScoreRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  podiumScore: {
    color: "#FFD978",
    fontSize: 11,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  podiumScoreEmpty: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: "700" },

  // Boş / Yükleniyor / Hata
  stateBox: {
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    paddingVertical: 22,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  stateOrb: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(246,200,110,0.14)",
    borderWidth: 1,
    borderColor: "rgba(246,200,110,0.35)",
    marginBottom: 4,
  },
  stateTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "900", textAlign: "center" },
  stateSub: { color: "#94A3B8", fontSize: 12, fontWeight: "600", textAlign: "center" },

  // Bölüm başlıkları
  sectionBlock: { marginTop: 15 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: { color: "#FFFFFF", fontSize: 15.5, fontWeight: "900", letterSpacing: -0.35 },
  sectionLinkBtn: { flexDirection: "row", alignItems: "center", gap: 2 },
  sectionLinkText: { color: "#60A5FA", fontSize: 12, fontWeight: "800" },
  sectionMetaPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  sectionMetaText: { color: "#94A3B8", fontSize: 10.5, fontWeight: "700" },

  // Ödül kartları
  rewardPairRow: { flexDirection: "row", gap: 9 },
  rewardScrollOuter: { marginHorizontal: -16 },
  rewardScrollContent: { paddingHorizontal: 16, gap: 9 },
  rewardCard: {
    borderRadius: 18,
    paddingTop: 9,
    paddingBottom: 10,
    paddingHorizontal: 10,
    alignItems: "center",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  rewardCardPair: { flex: 1, minWidth: 0 },
  rewardCardScroll: { width: 142 },
  rewardCardTop: { borderColor: "rgba(251,191,36,0.44)" },
  rewardTopRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  rewardRankPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  rewardRankPillText: { fontSize: 10, fontWeight: "900" },
  rewardDaysPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  rewardDaysText: { color: "#CBD5E1", fontSize: 9.5, fontWeight: "800" },
  rewardArtBox: {
    width: 60,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    marginBottom: 4,
  },
  rewardArtGlow: { position: "absolute", width: 48, height: 48, borderRadius: 24 },
  rewardFrameAvatar: { position: "absolute", alignItems: "center", justifyContent: "center" },
  rewardArtImg: { width: 58, height: 58, zIndex: 2 },
  rewardVal: {
    color: "#FFD978",
    fontSize: 13.5,
    fontWeight: "900",
    letterSpacing: -0.2,
    fontVariant: ["tabular-nums"],
  },
  rewardSub: {
    color: "#94A3B8",
    fontSize: 10.5,
    fontWeight: "700",
    marginTop: 2,
    maxWidth: "100%",
  },

  // Sıralama listesi (GlobalLeaderboardSheet ile birebir Sora koyu kart dili)
  lbList: { gap: 7 },
  lbRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.048)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.085)",
  },
  lbRowMe: {
    backgroundColor: "#14284A",
    borderWidth: 1.2,
    borderColor: "rgba(96,165,250,0.56)",
  },
  lbRankText: {
    width: 24,
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "900",
    marginRight: 8,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  lbRankTextMe: { color: "#60A5FA" },
  lbNameCol: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", marginLeft: 10 },
  lbName: { flexShrink: 1, color: "#FFFFFF", fontSize: 13.5, fontWeight: "800" },
  meBadge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: BRAND.blueBright,
  },
  meBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  lbScoreWrap: { flexDirection: "row", alignItems: "center", marginLeft: 8 },
  lbScore: { color: "#FFD978", fontSize: 13, fontWeight: "900", fontVariant: ["tabular-nums"] },
  lbIcon: { marginLeft: 4 },
  lbUnrankedText: { color: "#94A3B8", fontSize: 11.5, fontWeight: "700", marginLeft: 8 },

  // Alt CTA çubuğu (Android overflow:visible dış sarmalayıcı + overflow:hidden iç hap)
  ctaBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
    zIndex: 25,
  },
  ctaOuter: { height: 52, overflow: "visible" },
  ctaInner: {
    flex: 1,
    borderRadius: 26,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 56,
    paddingRight: 18,
    shadowOpacity: 0.42,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  ctaGloss: { position: "absolute", left: 0, right: 0, top: 0, height: 24 },
  ctaSheen: { position: "absolute", top: -10, bottom: -10, left: 0, width: 76 },
  ctaSheenBand: { flex: 1, transform: [{ skewX: "-20deg" }] },
  ctaRim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  ctaIconFloat: {
    position: "absolute",
    left: 14,
    top: -4,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 4,
    elevation: 7,
  },
  ctaIconImg: { width: 46, height: 46 },
  ctaText: {
    color: "#FFFFFF",
    fontSize: 15.5,
    fontWeight: "900",
    letterSpacing: -0.1,
    textShadowColor: "rgba(0,0,0,0.28)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
