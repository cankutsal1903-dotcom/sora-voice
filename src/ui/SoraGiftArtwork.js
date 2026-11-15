import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
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

// 34 hediyenin her biri için özel katmanlı görsel kompozisyon tarifleri
const GIFT_RECIPES = {
  // ── Uygun fiyatlı ──
  minik_kalp: {
    grad: ["#FF7EB3", "#FF477E", "#B51756"],
    ring: "rgba(255,225,238,0.52)",
    motif: "halo",
    main: { pack: "mci", name: "heart-multiple", color: "#FFFFFF", scale: 0.5 },
    subTopRight: { pack: "mci", name: "star-four-points", color: "#FFE58F", scale: 0.24 },
    subBottomLeft: { pack: "ion", name: "heart", color: "#FFD6E7", scale: 0.22 },
  },
  kahve_molasi: {
    grad: ["#D79A68", "#9C5B2E", "#4A2611"],
    ring: "rgba(255,233,204,0.45)",
    motif: "pedestal",
    main: { pack: "mci", name: "coffee", color: "#FFF8EE", scale: 0.5 },
    subTopRight: { pack: "mci", name: "waves", color: "#FFE3B8", scale: 0.24, rotate: "-90deg" },
    subBottomLeft: { pack: "ion", name: "heart", color: "#FFB59E", scale: 0.2 },
  },
  renkli_balon: {
    grad: ["#6EC6FF", "#3A86FF", "#5E3BEE"],
    ring: "rgba(255,255,255,0.46)",
    motif: "halo",
    main: { pack: "mci", name: "balloon", color: "#FFFFFF", scale: 0.52 },
    subTopRight: { pack: "mci", name: "balloon", color: "#FFD166", scale: 0.28, rotate: "16deg" },
    subBottomLeft: { pack: "mci", name: "balloon", color: "#FF7096", scale: 0.26, rotate: "-14deg" },
  },
  sans_kurabiyesi: {
    grad: ["#FFD166", "#E89020", "#8F4A08"],
    ring: "rgba(255,248,214,0.55)",
    motif: "diamond",
    main: { pack: "mci", name: "cookie", color: "#FFFDF5", scale: 0.48 },
    subTopRight: { pack: "mci", name: "star-four-points", color: "#FFFFFF", scale: 0.25 },
    subBottomLeft: { pack: "ion", name: "sparkles", color: "#FFE8A3", scale: 0.22 },
  },
  gulumseme: {
    grad: ["#FFE066", "#FF9F1C", "#E0630E"],
    ring: "rgba(255,250,220,0.55)",
    motif: "rays",
    main: { pack: "mci", name: "emoticon-happy", color: "#FFFFFF", scale: 0.52 },
    subTopRight: { pack: "mci", name: "star-four-points", color: "#FFF5BA", scale: 0.24 },
  },
  tatli_kedi: {
    grad: ["#A992FA", "#7452E3", "#3B2285"],
    ring: "rgba(235,226,255,0.48)",
    motif: "halo",
    main: { pack: "mci", name: "cat", color: "#FFFFFF", scale: 0.52 },
    subTopRight: { pack: "mci", name: "paw", color: "#FFB8D9", scale: 0.24, rotate: "18deg" },
    subBottomLeft: { pack: "ion", name: "heart", color: "#FFD166", scale: 0.2 },
  },
  ucan_opucuk: {
    grad: ["#FF6B9D", "#E62E6B", "#880E4F"],
    ring: "rgba(255,214,230,0.5)",
    motif: "arc",
    main: { pack: "mci", name: "emoticon-kiss", color: "#FFFFFF", scale: 0.48 },
    subTopRight: { pack: "ion", name: "heart", color: "#FFE082", scale: 0.26, rotate: "15deg" },
    subBottomLeft: { pack: "mci", name: "feather", color: "#FFD6E7", scale: 0.22, rotate: "-25deg" },
  },
  parilti: {
    grad: ["#64DFDF", "#2F80ED", "#1B3B82"],
    ring: "rgba(210,248,255,0.58)",
    motif: "diamond",
    main: { pack: "mci", name: "shimmer", color: "#FFFFFF", scale: 0.52 },
    subTopRight: { pack: "mci", name: "star-four-points", color: "#FFE680", scale: 0.25 },
    subBottomLeft: { pack: "mci", name: "flare", color: "#B8F2FF", scale: 0.24 },
  },

  // ── Oda temalı ──
  soz_sende: {
    grad: ["#56CCF2", "#2F80ED", "#143A78"],
    ring: "rgba(179,232,255,0.54)",
    motif: "waves",
    main: { pack: "mci", name: "account-voice", color: "#FFFFFF", scale: 0.5 },
    subTopRight: { pack: "ion", name: "mic", color: "#FFE082", scale: 0.24 },
  },
  alkis_yagmuru: {
    grad: ["#4FACFE", "#1F6AE1", "#12347A"],
    ring: "rgba(255,232,163,0.55)",
    motif: "rays",
    main: { pack: "mci", name: "hand-clap", color: "#FFFFFF", scale: 0.5 },
    subTopRight: { pack: "ion", name: "sparkles", color: "#FFD166", scale: 0.25 },
    subBottomLeft: { pack: "mci", name: "star-four-points", color: "#9EE7FF", scale: 0.22 },
  },
  sahne_isigi: {
    grad: ["#FFC857", "#E68A1E", "#1E355E"],
    ring: "rgba(255,238,186,0.58)",
    motif: "beam",
    main: { pack: "mci", name: "spotlight-beam", color: "#FFFFFF", scale: 0.52 },
    subTopRight: { pack: "ion", name: "star", color: "#FFE885", scale: 0.24 },
  },
  dj_seti: {
    grad: ["#9D50BB", "#4776E6", "#131E42"],
    ring: "rgba(148,226,255,0.56)",
    motif: "vinyl",
    main: { pack: "mci", name: "disc-player", color: "#FFFFFF", scale: 0.5 },
    subTopRight: { pack: "ion", name: "musical-notes", color: "#70F3FF", scale: 0.24 },
    subBottomLeft: { pack: "mci", name: "headphones", color: "#FFD166", scale: 0.23 },
  },
  konusma_taci: {
    grad: ["#F7C948", "#2F80ED", "#122B59"],
    ring: "rgba(255,226,133,0.68)",
    motif: "royal",
    main: { pack: "mci", name: "crown-circle", color: "#FFF8DC", scale: 0.52 },
    subBottomLeft: { pack: "ion", name: "mic", color: "#9EE7FF", scale: 0.23 },
    subTopRight: { pack: "mci", name: "star-four-points", color: "#FFE885", scale: 0.24 },
  },
  mikrofon_yildizi: {
    grad: ["#6A9CFD", "#2759C9", "#0E2254"],
    ring: "rgba(255,225,130,0.58)",
    motif: "diamond",
    main: { pack: "mci", name: "microphone-variant", color: "#FFFFFF", scale: 0.5 },
    subTopRight: { pack: "ion", name: "star", color: "#FFD166", scale: 0.26 },
    subBottomLeft: { pack: "mci", name: "star-four-points", color: "#90E0EF", scale: 0.22 },
  },
  dinleyici_destegi: {
    grad: ["#48CAE4", "#2563EB", "#132A63"],
    ring: "rgba(190,242,255,0.52)",
    motif: "waves",
    main: { pack: "mci", name: "headphones", color: "#FFFFFF", scale: 0.5 },
    subTopRight: { pack: "ion", name: "heart", color: "#FF7AA8", scale: 0.25 },
  },
  oda_yildizi: {
    grad: ["#3A8DFF", "#1D4ED8", "#0B1D4A"],
    ring: "rgba(255,220,115,0.72)",
    motif: "royal",
    main: { pack: "mci", name: "trophy-award", color: "#FFE57F", scale: 0.52 },
    subTopRight: { pack: "mci", name: "crown", color: "#FFF3B0", scale: 0.25 },
    subBottomLeft: { pack: "mci", name: "star-four-points", color: "#80EAFF", scale: 0.23 },
  },

  // ── Orta seviye ──
  gul_buketi: {
    grad: ["#FF5D8F", "#C9184A", "#590D22"],
    ring: "rgba(255,226,180,0.6)",
    motif: "pedestal",
    main: { pack: "ion", name: "rose", color: "#FFFFFF", scale: 0.5 },
    subTopRight: { pack: "mci", name: "flower-tulip", color: "#FFB3C6", scale: 0.26, rotate: "16deg" },
    subBottomLeft: { pack: "mci", name: "flower", color: "#FFE599", scale: 0.24 },
  },
  neon_mikrofon: {
    grad: ["#00F5D4", "#0088FF", "#1E1052"],
    ring: "rgba(0,245,212,0.72)",
    motif: "waves",
    main: { pack: "mci", name: "microphone-variant", color: "#FFFFFF", scale: 0.52 },
    subTopRight: { pack: "mci", name: "flare", color: "#00F5D4", scale: 0.26 },
    subBottomLeft: { pack: "ion", name: "musical-notes", color: "#FF70A6", scale: 0.22 },
  },
  disko_topu: {
    grad: ["#B57BFF", "#5B3FE8", "#181240"],
    ring: "rgba(220,205,255,0.65)",
    motif: "rays",
    main: { pack: "mci", name: "decagram", color: "#E8F7FF", scale: 0.52 },
    subTopRight: { pack: "ion", name: "sparkles", color: "#FFE66D", scale: 0.26 },
    subBottomLeft: { pack: "mci", name: "lightbulb-spot", color: "#72EFDD", scale: 0.24 },
  },
  yildiz_yagmuru: {
    grad: ["#3F7CAC", "#1C3F75", "#09152E"],
    ring: "rgba(255,224,130,0.64)",
    motif: "meteor",
    main: { pack: "mci", name: "star-shooting", color: "#FFE57F", scale: 0.54 },
    subTopRight: { pack: "ion", name: "star", color: "#FFFFFF", scale: 0.23 },
    subBottomLeft: { pack: "mci", name: "star-four-points", color: "#80EAFF", scale: 0.24 },
  },
  kristal_kelebek: {
    grad: ["#72EFDD", "#2196F3", "#152866"],
    ring: "rgba(202,248,255,0.7)",
    motif: "diamond",
    main: { pack: "mci", name: "butterfly", color: "#FFFFFF", scale: 0.52 },
    subTopRight: { pack: "mci", name: "diamond-stone", color: "#B8F8FF", scale: 0.24 },
    subBottomLeft: { pack: "mci", name: "shimmer", color: "#FFE89E", scale: 0.23 },
  },
  ay_isigi: {
    grad: ["#5E81F4", "#283E78", "#0C1633"],
    ring: "rgba(218,232,255,0.62)",
    motif: "halo",
    main: { pack: "mci", name: "weather-night", color: "#FFF5CC", scale: 0.52 },
    subTopRight: { pack: "mci", name: "star-four-points", color: "#FFFFFF", scale: 0.24 },
    subBottomLeft: { pack: "mci", name: "waves", color: "#9BC5FF", scale: 0.22 },
  },
  gokkusagi: {
    grad: ["#56CCF2", "#3A86FF", "#274690"],
    ring: "rgba(255,226,138,0.7)",
    motif: "rainbow",
    main: { pack: "mci", name: "looks", color: "#FFE680", scale: 0.56 },
    subTopRight: { pack: "ion", name: "sparkles", color: "#FFFFFF", scale: 0.24 },
    subBottomLeft: { pack: "mci", name: "star-four-points", color: "#FF9EBB", scale: 0.22 },
  },
  altin_tac: {
    grad: ["#FFE074", "#C98A12", "#1B2E59"],
    ring: "rgba(255,236,168,0.82)",
    motif: "royal",
    main: { pack: "mci", name: "crown", color: "#FFF9E2", scale: 0.54 },
    subTopRight: { pack: "mci", name: "diamond-stone", color: "#80EAFF", scale: 0.24 },
    subBottomLeft: { pack: "mci", name: "star-four-points", color: "#FFE57F", scale: 0.22 },
  },
  ferrari: {
    grad: ["#FF3B47", "#B81422", "#1A0B10"],
    ring: "rgba(255,215,102,0.72)",
    motif: "track",
    main: { pack: "mci", name: "car-sports", color: "#FFFFFF", scale: 0.56 },
    subTopRight: { pack: "mci", name: "shield-star", color: "#FFD60A", scale: 0.25 },
    subBottomLeft: { pack: "mci", name: "fire", color: "#FF9F1C", scale: 0.24, rotate: "-20deg" },
  },
  lamborghini: {
    grad: ["#FFD23F", "#C97A00", "#12161F"],
    ring: "rgba(255,232,128,0.78)",
    motif: "diamond",
    main: { pack: "mci", name: "car-convertible", color: "#FFFDF5", scale: 0.56 },
    subTopRight: { pack: "mci", name: "car-turbocharger", color: "#70F3FF", scale: 0.24 },
    subBottomLeft: { pack: "mci", name: "flare", color: "#FFE66D", scale: 0.25 },
  },

  // ── Gösterişli ──
  elmas_aslan: {
    grad: ["#70E1F5", "#1E56B5", "#091838"],
    ring: "rgba(186,247,255,0.86)",
    motif: "imperial",
    main: { pack: "mci", name: "shield-crown", color: "#E8FCFF", scale: 0.54 },
    subTopRight: { pack: "mci", name: "diamond-stone", color: "#FFE57F", scale: 0.27 },
    subBottomLeft: { pack: "mci", name: "crown", color: "#FFD166", scale: 0.24 },
  },
  gokyuzu_treni: {
    grad: ["#56CCF2", "#2558C9", "#0B193D"],
    ring: "rgba(184,236,255,0.78)",
    motif: "arc",
    main: { pack: "mci", name: "train-variant", color: "#FFFFFF", scale: 0.52 },
    subTopRight: { pack: "mci", name: "star-shooting", color: "#FFE57F", scale: 0.27 },
    subBottomLeft: { pack: "mci", name: "waves", color: "#9EE7FF", scale: 0.24 },
  },
  kraliyet_arabasi: {
    grad: ["#F6C945", "#8C5808", "#162447"],
    ring: "rgba(255,233,153,0.84)",
    motif: "imperial",
    main: { pack: "mci", name: "horse-variant", color: "#FFF9E6", scale: 0.5 },
    subTopRight: { pack: "mci", name: "crown", color: "#FFE066", scale: 0.28 },
    subBottomLeft: { pack: "mci", name: "star-circle", color: "#A8E6FF", scale: 0.24 },
  },
  isik_selalesi: {
    grad: ["#64F4FF", "#1A82E8", "#0A2152"],
    ring: "rgba(186,250,255,0.82)",
    motif: "beam",
    main: { pack: "mci", name: "waterfall", color: "#FFFFFF", scale: 0.54 },
    subTopRight: { pack: "mci", name: "shimmer", color: "#FFE885", scale: 0.26 },
    subBottomLeft: { pack: "mci", name: "waves", color: "#90F1FF", scale: 0.24 },
  },
  kozmik_balina: {
    grad: ["#38BDF8", "#2541B2", "#090F2C"],
    ring: "rgba(148,232,255,0.8)",
    motif: "meteor",
    main: { pack: "mci", name: "dolphin", color: "#E6FAFF", scale: 0.54 },
    subTopRight: { pack: "mci", name: "star-shooting", color: "#FFE57F", scale: 0.27 },
    subBottomLeft: { pack: "ion", name: "moon", color: "#B8E8FF", scale: 0.22 },
  },
  efsanevi_anka: {
    grad: ["#FFBE0B", "#FB5607", "#3A0CA3"],
    ring: "rgba(255,224,115,0.88)",
    motif: "imperial",
    main: { pack: "mci", name: "bird", color: "#FFF8E7", scale: 0.52 },
    subTopRight: { pack: "mci", name: "fire", color: "#FFE066", scale: 0.28 },
    subBottomLeft: { pack: "mci", name: "feather", color: "#FFB703", scale: 0.26, rotate: "-18deg" },
  },
  yildiz_gemisi: {
    grad: ["#4CC9F0", "#1D4ED8", "#070E26"],
    ring: "rgba(156,238,255,0.86)",
    motif: "meteor",
    main: { pack: "mci", name: "rocket-launch", color: "#FFFFFF", scale: 0.54 },
    subTopRight: { pack: "mci", name: "space-station", color: "#FFE57F", scale: 0.26 },
    subBottomLeft: { pack: "mci", name: "flare", color: "#72EFDD", scale: 0.25 },
  },
  kraliyet_sahnesi: {
    grad: ["#FFD166", "#1D4ED8", "#0A1433"],
    ring: "rgba(255,230,138,0.92)",
    motif: "imperial",
    main: { pack: "mci", name: "castle", color: "#FFF8DC", scale: 0.52 },
    subTopRight: { pack: "mci", name: "crown", color: "#FFE066", scale: 0.28 },
    subBottomLeft: { pack: "mci", name: "spotlight-beam", color: "#80EAFF", scale: 0.26 },
  },
};

const NAME_TO_GIFT_ID = Object.fromEntries(
  DEFAULT_GIFT_CATALOG.map((item) => [item.name.toLocaleLowerCase("tr-TR"), item.id]),
);

export const resolveGiftRecipeKey = (giftId, giftName) => {
  if (giftId && GIFT_RECIPES[giftId]) return giftId;
  if (giftName) {
    const byName = NAME_TO_GIFT_ID[String(giftName).trim().toLocaleLowerCase("tr-TR")];
    if (byName && GIFT_RECIPES[byName]) return byName;
  }
  return null;
};

function VectorGlyph({ spec, size }) {
  if (!spec) return null;
  const px = Math.max(9, Math.round(size * (spec.scale || 0.45)));
  const IconComp = spec.pack === "ion" ? Ionicons : MaterialCommunityIcons;
  return <IconComp name={spec.name} size={px} color={spec.color || "#FFFFFF"} />;
}

/**
 * 34 hediyenin her biri için katmanlı gradyan, geometrik hale/çerçeve ve çoklu vektör rozet sahnesi.
 */
export const SoraGiftArtwork = memo(function SoraGiftArtwork({
  giftId,
  giftName,
  fallbackIcon = "sparkles",
  fallbackColor = "#2F80ED",
  size = 54,
}) {
  const key = resolveGiftRecipeKey(giftId, giftName);
  const recipe = key ? GIFT_RECIPES[key] : null;
  const radius = Math.round(size * 0.34);

  if (!recipe) {
    return (
      <LinearGradient
        colors={[fallbackColor, "#153263"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          artStyles.box,
          { width: size, height: size, borderRadius: radius, borderColor: "rgba(255,255,255,0.34)" },
        ]}
      >
        <View style={[artStyles.sheen, { width: size * 0.8, height: size * 0.42, borderRadius: radius }]} />
        <Ionicons name={fallbackIcon || "sparkles"} size={Math.round(size * 0.46)} color="#FFFFFF" />
      </LinearGradient>
    );
  }

  const innerRingSize = Math.round(size * 0.76);
  const diamondSize = Math.round(size * 0.62);

  return (
    <LinearGradient
      colors={recipe.grad}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        artStyles.box,
        {
          width: size,
          height: size,
          borderRadius: radius,
          borderColor: recipe.ring,
          borderWidth: recipe.motif === "imperial" || recipe.motif === "royal" ? 1.8 : 1.2,
        },
      ]}
    >
      {/* Üst cam yansıması */}
      <View
        pointerEvents="none"
        style={[
          artStyles.sheen,
          {
            width: size * 0.92,
            height: size * 0.44,
            top: -size * 0.08,
            borderRadius: radius,
          },
        ]}
      />

      {/* Özel motif arka katmanları */}
      {(recipe.motif === "halo" || recipe.motif === "waves" || recipe.motif === "vinyl") && (
        <View
          pointerEvents="none"
          style={[
            artStyles.innerRing,
            {
              width: innerRingSize,
              height: innerRingSize,
              borderRadius: innerRingSize / 2,
              borderColor: recipe.ring,
            },
          ]}
        />
      )}

      {recipe.motif === "waves" && (
        <View
          pointerEvents="none"
          style={[
            artStyles.innerRing,
            {
              width: Math.round(size * 0.9),
              height: Math.round(size * 0.9),
              borderRadius: size,
              borderColor: "rgba(255,255,255,0.18)",
            },
          ]}
        />
      )}

      {(recipe.motif === "diamond" || recipe.motif === "imperial") && (
        <View
          pointerEvents="none"
          style={[
            artStyles.diamondPlate,
            {
              width: diamondSize,
              height: diamondSize,
              borderRadius: Math.max(5, Math.round(size * 0.11)),
              borderColor: recipe.ring,
            },
          ]}
        />
      )}

      {(recipe.motif === "royal" || recipe.motif === "imperial") && (
        <View
          pointerEvents="none"
          style={[
            artStyles.royalBase,
            {
              width: Math.round(size * 0.64),
              height: Math.max(4, Math.round(size * 0.09)),
              bottom: Math.round(size * 0.1),
              backgroundColor: recipe.ring,
            },
          ]}
        />
      )}

      {(recipe.motif === "rays" || recipe.motif === "beam") && (
        <>
          <View
            pointerEvents="none"
            style={[
              artStyles.lightBeam,
              {
                width: Math.round(size * 0.26),
                height: Math.round(size * 1.25),
                transform: [{ rotate: "32deg" }],
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              artStyles.lightBeam,
              {
                width: Math.round(size * 0.18),
                height: Math.round(size * 1.25),
                transform: [{ rotate: "-32deg" }],
              },
            ]}
          />
        </>
      )}

      {recipe.motif === "meteor" && (
        <>
          <View
            pointerEvents="none"
            style={[
              artStyles.meteorStreak,
              { width: size * 0.56, top: size * 0.24, left: size * 0.08 },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              artStyles.meteorStreak,
              { width: size * 0.42, bottom: size * 0.22, right: size * 0.1 },
            ]}
          />
        </>
      )}

      {recipe.motif === "rainbow" && (
        <View
          pointerEvents="none"
          style={[
            artStyles.rainbowArc,
            {
              width: Math.round(size * 0.82),
              height: Math.round(size * 0.82),
              borderRadius: size,
            },
          ]}
        />
      )}

      {recipe.motif === "track" && (
        <View
          pointerEvents="none"
          style={[
            artStyles.speedTrack,
            {
              width: Math.round(size * 0.8),
              bottom: Math.round(size * 0.15),
            },
          ]}
        />
      )}

      {(recipe.motif === "pedestal" || recipe.motif === "arc") && (
        <View
          pointerEvents="none"
          style={[
            artStyles.pedestalArc,
            {
              width: Math.round(size * 0.68),
              height: Math.round(size * 0.22),
              bottom: Math.round(size * 0.1),
              borderColor: recipe.ring,
            },
          ]}
        />
      )}

      {/* Ana ikon */}
      <View style={artStyles.mainGlyph}>
        <VectorGlyph spec={recipe.main} size={size} />
      </View>

      {/* Sağ üst vurgu ikonu */}
      {recipe.subTopRight ? (
        <View
          pointerEvents="none"
          style={[
            artStyles.subTopRight,
            {
              top: Math.max(3, Math.round(size * 0.08)),
              right: Math.max(3, Math.round(size * 0.08)),
              transform: recipe.subTopRight.rotate ? [{ rotate: recipe.subTopRight.rotate }] : undefined,
            },
          ]}
        >
          <VectorGlyph spec={recipe.subTopRight} size={size} />
        </View>
      ) : null}

      {/* Sol alt vurgu ikonu */}
      {recipe.subBottomLeft ? (
        <View
          pointerEvents="none"
          style={[
            artStyles.subBottomLeft,
            {
              bottom: Math.max(3, Math.round(size * 0.09)),
              left: Math.max(3, Math.round(size * 0.09)),
              transform: recipe.subBottomLeft.rotate ? [{ rotate: recipe.subBottomLeft.rotate }] : undefined,
            },
          ]}
        >
          <VectorGlyph spec={recipe.subBottomLeft} size={size} />
        </View>
      ) : null}
    </LinearGradient>
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
  box: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  sheen: {
    position: "absolute",
    left: -4,
    backgroundColor: "rgba(255,255,255,0.18)",
    transform: [{ rotate: "-14deg" }],
  },
  innerRing: {
    position: "absolute",
    borderWidth: 1.2,
  },
  diamondPlate: {
    position: "absolute",
    borderWidth: 1.3,
    backgroundColor: "rgba(255,255,255,0.09)",
    transform: [{ rotate: "45deg" }],
  },
  royalBase: {
    position: "absolute",
    borderRadius: 99,
    opacity: 0.75,
  },
  lightBeam: {
    position: "absolute",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  meteorStreak: {
    position: "absolute",
    height: 2,
    borderRadius: 2,
    backgroundColor: "rgba(255,235,153,0.52)",
    transform: [{ rotate: "-32deg" }],
  },
  rainbowArc: {
    position: "absolute",
    bottom: -14,
    borderWidth: 3,
    borderColor: "rgba(255,214,102,0.45)",
  },
  speedTrack: {
    position: "absolute",
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,214,102,0.55)",
  },
  pedestalArc: {
    position: "absolute",
    borderBottomWidth: 2,
    borderRadius: 99,
  },
  mainGlyph: {
    zIndex: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  subTopRight: {
    position: "absolute",
    zIndex: 4,
  },
  subBottomLeft: {
    position: "absolute",
    zIndex: 4,
  },
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
