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
// Etkinlik türüne göre render edilmiş banner görseli; bilinmeyen türler renk geçişine düşer.
const EVENT_BANNER_ART = {
  gift_race: require("../../assets/events/gift-race.webp"),
  room_party: require("../../assets/events/royal-night.webp"),
  love: require("../../assets/events/love-week.webp"),
  family_war: require("../../assets/events/family-war.webp"),
};
const GOLD_BUTTON = ["#FFE9A8", "#F2B33D", "#C98A1E"];

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
const MONTHS_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const AVATAR_PALETTE = ["#2F80ED", "#1C5FB8", "#8B6CEF", "#FF5C8A", "#F5A623", "#26A69A", "#E65C00", "#4B6CB7"];

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

const MEDALS = {
  gold: { colors: ["#FFE9A8", "#F6C86E", "#D99B1E"], solid: "#E8B54A", soft: "#FFF6DD", text: "#7A5300" },
  silver: { colors: ["#F6F8FB", "#C9D3DF", "#98A6B8"], solid: "#AEB9C7", soft: "#F1F4F8", text: "#4A5768" },
  bronze: { colors: ["#F8D2AE", "#D9915B", "#A9633A"], solid: "#CF8650", soft: "#FCEFE4", text: "#6E3B17" },
  blue: { colors: ["#8FC2FF", "#2F80ED", "#1C5FB8"], solid: "#2F80ED", soft: "#EAF2FF", text: "#1C4F96" },
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

const formatDateTime = (ms) => {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS_TR[d.getMonth()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const initialOf = (name) => {
  const first = Array.from(String(name || "").trim())[0];
  return first ? first.toLocaleUpperCase("tr-TR") : "S";
};

const colorFromName = (name) => {
  const str = String(name || "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
};

const medalForRank = (rank) => {
  const text = String(rank ?? "").trim();
  const num = parseInt(text, 10);
  if (num === 1) return MEDALS.gold;
  if (num === 2) return MEDALS.silver;
  if (num === 3 && !text.includes("-")) return MEDALS.bronze;
  return MEDALS.blue;
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

const EventAvatar = memo(function EventAvatar({ name, url, color, size = 40, ringColor }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [url]);
  const ring = ringColor ? { borderWidth: 2, borderColor: ringColor } : null;
  const dims = { width: size, height: size, borderRadius: size / 2 };
  if (url && !failed) {
    return <Image source={{ uri: url }} onError={() => setFailed(true)} style={[styles.avatarImage, dims, ring]} />;
  }
  return (
    <View style={[styles.avatarFallback, dims, { backgroundColor: color || colorFromName(name) }, ring]}>
      <Text style={[styles.avatarInitial, { fontSize: Math.round(size * 0.42) }]}>{initialOf(name)}</Text>
    </View>
  );
});

const CountdownBoxes = memo(function CountdownBoxes({ event }) {
  const upcoming = event.startsAtMs > Date.now();
  const remaining = useCountdownMs(upcoming ? event.startsAtMs : event.endsAtMs, "seconds");
  const { days, hours, minutes, seconds } = splitDuration(remaining);
  const ended = remaining <= 0;
  const parts = [
    { value: days, label: "GÜN" },
    { value: hours, label: "SAAT" },
    { value: minutes, label: "DK" },
    { value: seconds, label: "SN" },
  ];
  return (
    <View style={styles.cdWrap}>
      <Text style={styles.cdLabel}>{ended ? "Etkinlik sona erdi" : upcoming ? "Başlamasına kalan" : "Bitmesine kalan"}</Text>
      <View style={styles.cdRow}>
        {parts.map((part, i) => (
          <React.Fragment key={part.label}>
            {i > 0 ? <Text style={styles.cdColon}>:</Text> : null}
            <View style={styles.cdBox}>
              <Text style={styles.cdValue}>{pad2(part.value)}</Text>
              <Text style={styles.cdUnit}>{part.label}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
});

const SectionHeader = memo(function SectionHeader({ icon, title, color, right }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={[styles.sectionIcon, { backgroundColor: withAlpha(color, 0.12) }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right ? <View style={styles.sectionRight}>{right}</View> : null}
    </View>
  );
});

const RewardRow = memo(function RewardRow({ reward }) {
  const medal = medalForRank(reward.rank);
  const isTop = medal === MEDALS.gold;
  return (
    <View style={[styles.rewardRow, { backgroundColor: medal.soft }, isTop && styles.rewardRowTop]}>
      <LinearGradient colors={medal.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rewardMedal}>
        {medal === MEDALS.blue ? (
          <Text style={styles.rewardMedalTextSmall} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {reward.rank}
          </Text>
        ) : (
          <MaterialCommunityIcons name={isTop ? "crown" : "medal"} size={20} color="#FFFFFF" />
        )}
      </LinearGradient>
      <View style={styles.rewardTextCol}>
        <Text style={[styles.rewardRank, { color: medal.text }]}>{reward.rank} sıra</Text>
        {reward.label ? (
          <Text style={styles.rewardLabel} numberOfLines={2}>
            {reward.label}
          </Text>
        ) : null}
      </View>
      {reward.credits > 0 ? (
        <View style={styles.rewardCredits}>
          <MaterialCommunityIcons name="star-four-points" size={11} color="#C98A00" />
          <Text style={styles.rewardCreditsText} numberOfLines={1}>
            {formatCompact(reward.credits)}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const PodiumColumn = memo(function PodiumColumn({ row, place, unit, isMe }) {
  const medal = place === 1 ? MEDALS.gold : place === 2 ? MEDALS.silver : MEDALS.bronze;
  const size = place === 1 ? 58 : 46;
  const pedestal = place === 1 ? styles.podiumBaseFirst : place === 2 ? styles.podiumBaseSecond : styles.podiumBaseThird;
  return (
    <View style={styles.podiumCol}>
      {place === 1 ? <MaterialCommunityIcons name="crown" size={22} color={BRAND.gold} style={styles.podiumCrown} /> : null}
      <EventAvatar name={row.display_name} url={row.avatar_url} color={row.avatar_color} size={size} ringColor={medal.solid} />
      <Text style={[styles.podiumName, isMe && styles.podiumNameMe]} numberOfLines={1}>
        {isMe ? "Sen" : row.display_name}
      </Text>
      <Text style={styles.podiumScore} numberOfLines={1}>
        {formatCompact(row.score)} {unit}
      </Text>
      <LinearGradient colors={medal.colors} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={[styles.podiumBase, pedestal]}>
        <Text style={styles.podiumPlace}>{place}</Text>
      </LinearGradient>
    </View>
  );
});

const LeaderboardRow = memo(function LeaderboardRow({ row, unit, isMe, accent }) {
  const medal = row.rank <= 3 ? medalForRank(row.rank) : null;
  return (
    <View style={[styles.lbRow, isMe && styles.lbRowMe, isMe && { borderColor: accent }]}>
      <View style={styles.lbRankBox}>
        {medal ? (
          <MaterialCommunityIcons name="medal" size={22} color={medal.solid} />
        ) : (
          <Text style={styles.lbRankText}>{row.rank}</Text>
        )}
      </View>
      <EventAvatar name={row.display_name} url={row.avatar_url} color={row.avatar_color} size={38} />
      <View style={styles.lbNameCol}>
        <Text style={styles.lbName} numberOfLines={1}>
          {row.display_name}
        </Text>
        {isMe ? (
          <View style={[styles.meBadge, { backgroundColor: accent }]}>
            <Text style={styles.meBadgeText}>SEN</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.lbScore} numberOfLines={1}>
        {formatThousands(row.score)} <Text style={styles.lbUnit}>{unit}</Text>
      </Text>
    </View>
  );
});

const LeaderboardSection = memo(function LeaderboardSection({ event, enabled, currentUserId }) {
  const { rows, loading, error, retry } = useEventLeaderboard(event.id, enabled);
  const accent = event.colors[1] || BRAND.blueBright;
  const me = currentUserId ? String(currentUserId) : null;
  const showPodium = rows.length >= 3;
  const podium = showPodium ? [rows[1], rows[0], rows[2]] : [];
  const rest = showPodium ? rows.slice(3) : rows;
  const myRow = me ? rows.find((r) => r.user_id === me) : null;

  return (
    <View style={styles.section}>
      <SectionHeader
        icon="podium"
        title="Sıralama"
        color={BRAND.blue}
        right={myRow ? <Text style={styles.myRankText}>Senin sıran: {myRow.rank}.</Text> : null}
      />
      {loading ? (
        <View style={styles.lbLoading}>
          <ActivityIndicator color={BRAND.blueBright} />
          <Text style={styles.lbLoadingText}>Sıralama yükleniyor…</Text>
        </View>
      ) : error && rows.length === 0 ? (
        <Pressable onPress={retry} accessibilityRole="button" style={styles.emptyBox}>
          <View style={[styles.emptyIcon, { backgroundColor: withAlpha(BRAND.blueBright, 0.14) }]}>
            <Ionicons name="cloud-offline-outline" size={26} color={BRAND.blue} />
          </View>
          <Text style={styles.emptyTitle}>Sıralama şu an yüklenemedi</Text>
          <Text style={styles.emptySub}>Tekrar denemek için dokun.</Text>
        </Pressable>
      ) : rows.length === 0 ? (
        <View style={styles.emptyBox}>
          <View style={[styles.emptyIcon, { backgroundColor: withAlpha(event.accent, 0.16) }]}>
            <Ionicons name="gift" size={26} color={event.colors[1] || BRAND.blue} />
          </View>
          <Text style={styles.emptyTitle}>Sıralama yakında güncellenecek — ilk sen hediye gönder!</Text>
          <Text style={styles.emptySub}>Zirvedeki ilk isim olma fırsatını kaçırma.</Text>
        </View>
      ) : (
        <View>
          {showPodium ? (
            <View style={styles.podiumRow}>
              {podium.map((row, i) => (
                <PodiumColumn key={row.user_id} row={row} place={[2, 1, 3][i]} unit={event.unit} isMe={me === row.user_id} />
              ))}
            </View>
          ) : null}
          {rest.map((row) => (
            <LeaderboardRow key={`${row.user_id}-${row.rank}`} row={row} unit={event.unit} isMe={me === row.user_id} accent={accent} />
          ))}
        </View>
      )}
    </View>
  );
});

export const EventDetailSheet = memo(function EventDetailSheet({ visible, event, currentUserId, onDismiss, onSendGift }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const sheetHeight = Math.round(windowHeight * 0.86);

  // Kapanış animasyonu sırasında içerik kaybolmasın diye son etkinliği tut.
  const lastEventRef = useRef(null);
  if (event) lastEventRef.current = event;
  const shownEvent = event || lastEventRef.current;

  const [mounted, setMounted] = useState(Boolean(visible && shownEvent));
  const progress = useRef(new Animated.Value(visible && shownEvent ? 1 : 0)).current;
  const floatValue = useLoopAnimation(mounted && !reducedMotion, floatFactory);
  const pulseValue = useLoopAnimation(mounted && !reducedMotion, pulseFactory);

  useEffect(() => {
    let anim = null;
    if (visible && shownEvent) {
      setMounted(true);
      anim = Animated.timing(progress, {
        toValue: 1,
        duration: reducedMotion ? 0 : 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      anim.start();
    } else {
      anim = Animated.timing(progress, {
        toValue: 0,
        duration: reducedMotion ? 0 : 220,
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

  if (!shownEvent || !mounted) return null;

  const ev = shownEvent;
  const upcoming = ev.startsAtMs > Date.now();
  const last = ev.colors[ev.colors.length - 1];
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [sheetHeight, 0] });
  const artY = floatValue.interpolate({ inputRange: [0, 1], outputRange: [4, -8] });
  const artGlow = pulseValue.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.1] });
  const bottomPad = Math.max(insets.bottom, 12);
  const ctaColors = [ev.colors[0], ev.colors[1] || BRAND.blueBright];

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={handleDismiss}>
      <View style={styles.modalRoot}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} accessibilityLabel="Kapat" />
        </Animated.View>

        <Animated.View style={[styles.sheet, { height: sheetHeight, transform: [{ translateY }] }]}>
          <Pressable
            onPress={handleDismiss}
            hitSlop={10}
            style={[styles.closeBtn, { zIndex: 20 }]}
            accessibilityRole="button"
            accessibilityLabel="Kapat"
          >
            <Ionicons name="close" size={19} color="#FFFFFF" />
          </Pressable>

          {/* Tam kaydırılabilir içerik (Hero + Kurallar + Ödüller + Sıralama) */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={{ paddingBottom: bottomPad + 92 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hero}>
              <LinearGradient colors={[BRAND.ink, BRAND.navy]} style={StyleSheet.absoluteFill} />
              <LinearGradient
                colors={[withAlpha(ev.colors[0], 0.96), withAlpha(ev.colors[1] || last, 0.82), withAlpha(last, 0.5)]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <LinearGradient
                colors={["rgba(16,24,32,0)", "rgba(16,24,32,0.58)"]}
                start={{ x: 0, y: 0.3 }}
                end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View pointerEvents="none" style={[styles.heroOrbA, { backgroundColor: withAlpha(ev.accent, 0.1) }]} />
              <View pointerEvents="none" style={styles.heroOrbB} />

              <View style={styles.grabber} />

              <View style={styles.heroTop}>
                <View style={styles.heroTextCol}>
                  <LiveKicker upcoming={upcoming} pulseValue={pulseValue} />
                  <Text style={styles.heroTitle} numberOfLines={2}>
                    {ev.title}
                  </Text>
                  {ev.subtitle ? (
                    <Text style={styles.heroSubtitle} numberOfLines={2}>
                      {ev.subtitle}
                    </Text>
                  ) : null}
                  <View style={styles.heroDateRow}>
                    <Ionicons name="calendar-outline" size={11} color="rgba(255,255,255,0.8)" />
                    <Text style={styles.heroDate} numberOfLines={1}>
                      {formatDateTime(ev.startsAtMs)} – {formatDateTime(ev.endsAtMs)}
                    </Text>
                  </View>
                </View>
                <View style={styles.heroArt} pointerEvents="none">
                  <Animated.View
                    style={[styles.heroArtGlow, { backgroundColor: withAlpha(ev.accent, 0.16), transform: [{ scale: artGlow }] }]}
                  />
                  <Animated.View style={{ transform: [{ translateY: artY }] }}>
                    <EventArtwork event={ev} size={74} />
                  </Animated.View>
                </View>
              </View>

              <CountdownBoxes event={ev} />
            </View>

            <View style={styles.bodyContent}>
            {ev.description ? <Text style={styles.description}>{ev.description}</Text> : null}

            {ev.rules.length ? (
              <View style={styles.section}>
                <SectionHeader icon="help-circle" title="Nasıl katılırım?" color={ev.colors[1] || BRAND.blue} />
                {ev.rules.map((rule, i) => (
                  <View key={`rule-${i}`} style={styles.ruleRow}>
                    <LinearGradient colors={ctaColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ruleNum}>
                      <Text style={styles.ruleNumText}>{i + 1}</Text>
                    </LinearGradient>
                    <Text style={styles.ruleText}>{rule}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {ev.rewards.length ? (
              <View style={styles.section}>
                <SectionHeader icon="gift" title="Ödüller" color="#D99B1E" />
                {ev.rewards.map((reward, i) => (
                  <RewardRow key={`reward-${i}`} reward={reward} />
                ))}
              </View>
            ) : null}

            <LeaderboardSection event={ev} enabled={mounted} currentUserId={currentUserId} />
            </View>
          </ScrollView>

          {/* Yapışkan CTA */}
          <View style={[styles.ctaBar, { paddingBottom: bottomPad + 4 }]}>
            <Pressable
              onPress={handleCta}
              accessibilityRole="button"
              accessibilityLabel="Hediye Gönder ve Katıl"
              style={({ pressed }) => [styles.ctaButton, pressed && styles.pressed]}
            >
              <LinearGradient colors={ctaColors} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(255,255,255,0.22)", "rgba(255,255,255,0)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.ctaGloss}
              />
              <Ionicons name="gift" size={19} color="#FFFFFF" />
              <Text style={styles.ctaText}>Hediye Gönder ve Katıl</Text>
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

  // Sheet
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { backgroundColor: "rgba(5,10,20,0.62)" },
  sheet: {
    width: "100%",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
  },
  hero: { paddingTop: 10, paddingHorizontal: 16, paddingBottom: 14, overflow: "hidden" },
  heroOrbA: { position: "absolute", width: 240, height: 240, borderRadius: 120, right: -70, top: -70 },
  heroOrbB: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    left: -40,
    bottom: -50,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  grabber: {
    alignSelf: "center",
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.45)",
    marginBottom: 10,
  },
  closeBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16,24,32,0.4)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  heroTop: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  heroTextCol: { flex: 1, paddingRight: 8 },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: -0.4,
    marginTop: 7,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  heroSubtitle: { color: "rgba(255,255,255,0.88)", fontSize: 12.5, fontWeight: "600", lineHeight: 17, marginTop: 3 },
  heroDateRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  heroDate: { color: "rgba(255,255,255,0.8)", fontSize: 10.5, fontWeight: "700", marginLeft: 5 },
  heroArt: { width: 88, height: 88, alignItems: "center", justifyContent: "center", marginRight: 22 },
  heroArtGlow: { position: "absolute", width: 80, height: 80, borderRadius: 40 },
  cdWrap: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: "rgba(16,24,32,0.42)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  cdLabel: { color: "rgba(255,255,255,0.72)", fontSize: 10, fontWeight: "800", letterSpacing: 0.6, textAlign: "center" },
  cdRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 5 },
  cdColon: { color: BRAND.goldLight, fontSize: 17, fontWeight: "900", marginHorizontal: 4, marginBottom: 10 },
  cdBox: {
    minWidth: 46,
    paddingVertical: 4,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,217,120,0.28)",
  },
  cdValue: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", fontVariant: ["tabular-nums"] },
  cdUnit: { color: BRAND.goldLight, fontSize: 9, fontWeight: "900", letterSpacing: 0.8, marginTop: 1 },

  body: { flex: 1, backgroundColor: "#FFFFFF" },
  bodyContent: { paddingHorizontal: 18, paddingTop: 16 },
  description: { color: "#3B4A5E", fontSize: 13.5, lineHeight: 20, fontWeight: "500", marginBottom: 6 },
  section: { marginTop: 16 },
  sectionHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  sectionIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 9 },
  sectionTitle: { flex: 1, color: BRAND.ink, fontSize: 17, fontWeight: "900", letterSpacing: -0.2 },
  sectionRight: { marginLeft: 8 },
  ruleRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  ruleNum: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 10, marginTop: 1 },
  ruleNumText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  ruleText: { flex: 1, color: "#2A3A50", fontSize: 13.5, lineHeight: 20, fontWeight: "600" },

  rewardRow: { flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 16, marginBottom: 8 },
  rewardRowTop: { borderWidth: 1, borderColor: "rgba(246,200,110,0.7)" },
  rewardMedal: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", marginRight: 10 },
  rewardMedalTextSmall: { color: "#FFFFFF", fontSize: 11, fontWeight: "900", paddingHorizontal: 3 },
  rewardTextCol: { flex: 1, minWidth: 0 },
  rewardRank: { fontSize: 11, fontWeight: "900", letterSpacing: 0.4 },
  rewardLabel: { color: BRAND.ink, fontSize: 13.5, fontWeight: "800", marginTop: 2 },
  rewardCredits: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#FFF3D1",
    marginLeft: 8,
  },
  rewardCreditsText: { color: "#8A5A00", fontSize: 11.5, fontWeight: "900", marginLeft: 3 },

  myRankText: { color: BRAND.blue, fontSize: 12, fontWeight: "900" },
  lbLoading: { alignItems: "center", paddingVertical: 22 },
  lbLoadingText: { color: "#6B7A8F", fontSize: 12, fontWeight: "700", marginTop: 8 },
  emptyBox: {
    alignItems: "center",
    paddingVertical: 22,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: "#F5F8FD",
    borderWidth: 1,
    borderColor: "#E3EBF6",
    borderStyle: "dashed",
  },
  emptyIcon: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  emptyTitle: { color: BRAND.ink, fontSize: 14, fontWeight: "800", textAlign: "center", lineHeight: 20 },
  emptySub: { color: "#6B7A8F", fontSize: 12, fontWeight: "600", textAlign: "center", marginTop: 4 },

  podiumRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", marginBottom: 12, paddingTop: 6 },
  podiumCol: { flex: 1, alignItems: "center", marginHorizontal: 4 },
  podiumCrown: { marginBottom: 2 },
  podiumName: { color: BRAND.ink, fontSize: 12, fontWeight: "800", marginTop: 6, maxWidth: "100%" },
  podiumNameMe: { color: BRAND.blue },
  podiumScore: { color: "#6B7A8F", fontSize: 11, fontWeight: "800", marginTop: 1 },
  podiumBase: {
    width: "100%",
    marginTop: 6,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  podiumBaseFirst: { height: 56 },
  podiumBaseSecond: { height: 42 },
  podiumBaseThird: { height: 32 },
  podiumPlace: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  lbRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    marginBottom: 6,
    backgroundColor: "#F7F9FC",
    borderWidth: 1,
    borderColor: "transparent",
  },
  lbRowMe: { backgroundColor: "#EAF2FF" },
  lbRankBox: { width: 28, alignItems: "center", marginRight: 8 },
  lbRankText: { color: "#6B7A8F", fontSize: 14, fontWeight: "900" },
  lbNameCol: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", marginLeft: 10 },
  lbName: { flexShrink: 1, color: BRAND.ink, fontSize: 14, fontWeight: "800" },
  meBadge: { marginLeft: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  meBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900", letterSpacing: 0.6 },
  lbScore: { color: BRAND.ink, fontSize: 13, fontWeight: "900", marginLeft: 8 },
  lbUnit: { color: "#6B7A8F", fontSize: 11, fontWeight: "700" },

  avatarImage: { backgroundColor: "#E6EDF7" },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: "#FFFFFF", fontWeight: "900" },

  ctaBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 12,
    backgroundColor: "rgba(255,255,255,0.97)",
    borderTopWidth: 1,
    borderTopColor: "#EEF2F8",
  },
  ctaButton: {
    height: 54,
    borderRadius: 18,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0B1E3F",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  ctaGloss: { position: "absolute", left: 0, right: 0, top: 0, height: 27 },
  ctaText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900", letterSpacing: 0.2, marginLeft: 8 },
});
