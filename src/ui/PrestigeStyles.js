import { memo, useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { getWealthTier } from "./SoraWealthTier";

const PREFS_KEY = "sora.prestige.styles.v1";

export const ENTRANCE_STYLES = [
  {
    id: "auto",
    name: "Otomatik",
    subtitle: "Seviyene göre",
    minWealth: 0,
    colors: ["rgba(47,128,237,0.92)", "rgba(25,68,136,0.92)", "rgba(12,24,48,0.92)"],
    border: "rgba(186,230,253,0.5)",
    icon: "flash",
    tint: "#BAE6FD",
    tagline: "Odaya katıldı",
  },
  {
    id: "sapphire_beam",
    name: "Safir Işın",
    subtitle: "Safir I+",
    minWealth: 4,
    colors: ["rgba(14,165,233,0.95)", "rgba(37,99,235,0.94)", "rgba(15,23,58,0.94)"],
    border: "rgba(125,211,252,0.85)",
    icon: "diamond",
    tint: "#E0F2FE",
    tagline: "Safir ışığıyla odaya ışınlandı",
  },
  {
    id: "royal_convoy",
    name: "Kraliyet Konvoyu",
    subtitle: "Hükümdar I+",
    minWealth: 7,
    colors: ["rgba(245,176,42,0.96)", "rgba(180,83,9,0.95)", "rgba(69,26,3,0.95)"],
    border: "rgba(254,240,138,0.9)",
    icon: "crown",
    iconLib: "mci",
    tint: "#FEF08A",
    tagline: "Altın konvoyla sahneye teşrif etti",
  },
  {
    id: "legend_phoenix",
    name: "Efsane Şöleni",
    subtitle: "Efsane I+",
    minWealth: 12,
    colors: ["rgba(124,58,237,0.96)", "rgba(190,24,93,0.95)", "rgba(234,179,8,0.94)"],
    border: "rgba(253,224,71,0.95)",
    icon: "fire",
    iconLib: "mci",
    tint: "#FEF08A",
    tagline: "Efsane aurasıyla odaya iniş yaptı",
  },
];

export const BUBBLE_STYLES = [
  {
    id: "default",
    name: "Klasik",
    minWealth: 0,
    bg: "rgba(255,255,255,0.06)",
    border: "rgba(255,255,255,0.08)",
    textColor: "#EEF4FC",
    previewColors: ["#1C2840", "#131C2F"],
  },
  {
    id: "sapphire_ice",
    name: "Safir Buzul",
    minWealth: 4,
    bg: "rgba(14,116,184,0.28)",
    border: "rgba(125,211,252,0.52)",
    textColor: "#E0F2FE",
    previewColors: ["#0369A1", "#1E3A8A"],
  },
  {
    id: "royal_gold",
    name: "Hükümdar Altın",
    minWealth: 7,
    bg: "rgba(180,115,16,0.28)",
    border: "rgba(251,191,36,0.62)",
    textColor: "#FEF3C7",
    previewColors: ["#B45309", "#78350F"],
  },
  {
    id: "legend_flame",
    name: "Efsane Mor Alev",
    minWealth: 12,
    bg: "rgba(109,40,217,0.32)",
    border: "rgba(245,158,11,0.72)",
    textColor: "#FFFBEB",
    previewColors: ["#6D28D9", "#BE185D"],
  },
];

const ENTRANCE_BY_ID = new Map(ENTRANCE_STYLES.map((s) => [s.id, s]));
const BUBBLE_BY_ID = new Map(BUBBLE_STYLES.map((s) => [s.id, s]));

let cachedPrefs = { entranceId: "auto", bubbleId: "default" };
let prefsLoaded = false;
const prefListeners = new Set();

const emitPrefs = () => {
  const snap = { ...cachedPrefs };
  prefListeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {}
  });
};

const loadPrefsOnce = () => {
  if (prefsLoaded) return;
  prefsLoaded = true;
  AsyncStorage.getItem(PREFS_KEY)
    .then((raw) => {
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        cachedPrefs = {
          entranceId: ENTRANCE_BY_ID.has(parsed.entranceId) ? parsed.entranceId : "auto",
          bubbleId: BUBBLE_BY_ID.has(parsed.bubbleId) ? parsed.bubbleId : "default",
        };
        emitPrefs();
      }
    })
    .catch(() => undefined);
};

export function getPrestigePrefsSnapshot() {
  loadPrefsOnce();
  return cachedPrefs;
}

export function setPrestigePrefs(patch) {
  cachedPrefs = {
    entranceId: ENTRANCE_BY_ID.has(patch?.entranceId) ? patch.entranceId : cachedPrefs.entranceId,
    bubbleId: BUBBLE_BY_ID.has(patch?.bubbleId) ? patch.bubbleId : cachedPrefs.bubbleId,
  };
  prefsLoaded = true;
  AsyncStorage.setItem(PREFS_KEY, JSON.stringify(cachedPrefs)).catch(() => undefined);
  emitPrefs();
}

export function usePrestigeStylePrefs() {
  const [prefs, setPrefs] = useState(cachedPrefs);

  useEffect(() => {
    loadPrefsOnce();
    prefListeners.add(setPrefs);
    setPrefs({ ...cachedPrefs });
    return () => {
      prefListeners.delete(setPrefs);
    };
  }, []);

  const updateEntrance = useCallback((entranceId) => setPrestigePrefs({ entranceId }), []);
  const updateBubble = useCallback((bubbleId) => setPrestigePrefs({ bubbleId }), []);

  return { ...prefs, updateEntrance, updateBubble };
}

export function resolveEntranceStyle(requestedId, wealthLevel = 0, isHost = false) {
  const lvl = Math.max(0, Number(wealthLevel) || 0);
  if (requestedId && requestedId !== "auto") {
    const picked = ENTRANCE_BY_ID.get(requestedId);
    if (picked && lvl >= picked.minWealth) return picked;
  }
  if (lvl >= 12) return ENTRANCE_BY_ID.get("legend_phoenix");
  if (lvl >= 7) return ENTRANCE_BY_ID.get("royal_convoy");
  if (lvl >= 4) return ENTRANCE_BY_ID.get("sapphire_beam");
  if (isHost) {
    return {
      id: "host",
      colors: ["rgba(246,200,110,0.95)", "rgba(196,130,36,0.94)", "rgba(88,52,14,0.92)"],
      border: "rgba(255,237,179,0.8)",
      icon: "sparkles",
      tint: "#FFF5D6",
      tagline: "Oda sahibi sahneye geldi",
    };
  }
  return ENTRANCE_BY_ID.get("auto");
}

export function resolveBubbleStyle(bubbleId, senderGiftSpent = 0) {
  const wealthLevel = getWealthTier(senderGiftSpent).tier.level;
  if (bubbleId && BUBBLE_BY_ID.has(bubbleId)) {
    const picked = BUBBLE_BY_ID.get(bubbleId);
    if (wealthLevel >= picked.minWealth) return picked;
  }
  return BUBBLE_BY_ID.get("default");
}

export const PrestigeStylePicker = memo(function PrestigeStylePicker({ giftSpent = 0 }) {
  const wealthLevel = getWealthTier(giftSpent).tier.level;
  const { entranceId, bubbleId, updateEntrance, updateBubble } = usePrestigeStylePrefs();

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>ODAYA GİRİŞ EFEKTİ</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {ENTRANCE_STYLES.map((item) => {
          const unlocked = wealthLevel >= item.minWealth;
          const active = entranceId === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                if (unlocked) updateEntrance(item.id);
              }}
              style={[
                styles.chip,
                active && styles.chipActive,
                !unlocked && styles.chipLocked,
              ]}
            >
              <LinearGradient
                colors={item.colors}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.chipSwatch}
              >
                {item.iconLib === "mci" ? (
                  <MaterialCommunityIcons name={item.icon} size={15} color={item.tint} />
                ) : (
                  <Ionicons name={item.icon} size={15} color={item.tint} />
                )}
              </LinearGradient>
              <View style={styles.chipTextCol}>
                <Text style={styles.chipName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.chipSub} numberOfLines={1}>
                  {unlocked ? (active ? "Seçili" : item.subtitle) : `🔒 ${item.subtitle}`}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={[styles.label, { marginTop: 12 }]}>SOHBET BALONU TEMASI</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {BUBBLE_STYLES.map((item) => {
          const unlocked = wealthLevel >= item.minWealth;
          const active = bubbleId === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                if (unlocked) updateBubble(item.id);
              }}
              style={[
                styles.chip,
                active && styles.chipActive,
                !unlocked && styles.chipLocked,
              ]}
            >
              <LinearGradient
                colors={item.previewColors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.chipSwatch, { borderWidth: 1, borderColor: item.border }]}
              >
                <Ionicons name="chatbubble" size={14} color={item.textColor} />
              </LinearGradient>
              <View style={styles.chipTextCol}>
                <Text style={styles.chipName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.chipSub} numberOfLines={1}>
                  {unlocked
                    ? active
                      ? "Seçili"
                      : "Açık"
                    : `🔒 Sv.${item.minWealth}`}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 14,
  },
  label: {
    color: "#6B7B90",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.7,
    marginBottom: 7,
  },
  row: {
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "#F3F6FB",
    borderWidth: 1.5,
    borderColor: "#E3EAF4",
    minWidth: 132,
  },
  chipActive: {
    borderColor: "#2F80ED",
    backgroundColor: "#EAF3FF",
  },
  chipLocked: {
    opacity: 0.62,
  },
  chipSwatch: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  chipTextCol: {
    flexShrink: 1,
  },
  chipName: {
    color: "#121C2B",
    fontSize: 12,
    fontWeight: "800",
  },
  chipSub: {
    color: "#63758C",
    fontSize: 10.5,
    fontWeight: "600",
    marginTop: 1,
  },
});
