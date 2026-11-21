import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getGlobalLeaderboard } from "../data/soraRepository";
import { SoraWealthBadge } from "../ui/SoraWealthTier";
import { SoraLevelCrest } from "../ui/SoraGiftArtwork";

const TABS = [
  { key: "mostGenerous", label: "En Cömertler", icon: "diamond", accent: "#FBBF24" },
  { key: "activeFamilies", label: "Aktif Aileler", icon: "people", accent: "#A78BFA" },
  { key: "topLevels", label: "Zirve Seviye", icon: "star", accent: "#60A5FA" },
];

const MEDAL_THEME = {
  1: {
    ring: "#FBBF24",
    badgeBg: "rgba(251,191,36,0.20)",
    badgeBorder: "rgba(251,191,36,0.55)",
    pedestal: ["rgba(251,191,36,0.26)", "rgba(251,191,36,0.06)"],
    text: "#FDE68A",
    icon: "crown",
    avatarSize: 68,
    pedestalHeight: 62,
  },
  2: {
    ring: "#CBD5E1",
    badgeBg: "rgba(203,213,225,0.16)",
    badgeBorder: "rgba(203,213,225,0.45)",
    pedestal: ["rgba(203,213,225,0.18)", "rgba(203,213,225,0.04)"],
    text: "#E2E8F0",
    icon: "medal",
    avatarSize: 56,
    pedestalHeight: 46,
  },
  3: {
    ring: "#FB923C",
    badgeBg: "rgba(251,146,60,0.18)",
    badgeBorder: "rgba(251,146,60,0.48)",
    pedestal: ["rgba(251,146,60,0.20)", "rgba(251,146,60,0.04)"],
    text: "#FED7AA",
    icon: "medal",
    avatarSize: 56,
    pedestalHeight: 38,
  },
};

const CACHE_TTL_MS = 45_000;
let cachedLeaderboardUserId = null;
let cachedLeaderboardData = null;
let cachedLeaderboardAt = 0;

function resetLeaderboardCacheIfUserChanged(userId) {
  if (userId && cachedLeaderboardUserId && cachedLeaderboardUserId !== userId) {
    cachedLeaderboardData = null;
    cachedLeaderboardAt = 0;
  }
  if (userId) cachedLeaderboardUserId = userId;
}

const fmtCompact = (raw) => {
  const n = Math.max(0, Number(raw) || 0);
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(".", ",").replace(/,0$/, "")} Mr`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",").replace(/,0$/, "")} Mn`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(".", ",").replace(/,0$/, "")} B`;
  return String(Math.floor(n));
};

const formatPrimaryMetric = (tabKey, item) => {
  if (!item) return "";
  if (tabKey === "mostGenerous") return fmtCompact(item.score);
  if (tabKey === "activeFamilies") return `${fmtCompact(item.score)} XP`;
  return `Sv. ${item.level}`;
};

const formatSecondaryLine = (tabKey, item) => {
  if (!item) return "";
  if (tabKey === "mostGenerous") {
    return `Sv. ${item.level}${item.handle ? ` · @${item.handle}` : ""}`;
  }
  if (tabKey === "activeFamilies") {
    const members = item.memberCount ?? 0;
    return `Sv. ${item.level} · ${members} üye`;
  }
  return `${fmtCompact(item.secondaryScore)} XP${item.handle ? ` · @${item.handle}` : ""}`;
};

const EntityAvatar = memo(function EntityAvatar({ item, size, borderColor, isFamily }) {
  const radius = isFamily ? Math.round(size * 0.30) : Math.round(size / 2);
  return (
    <View
      style={[
        styles.avatarWrap,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: item?.color || "#2F80ED",
          borderColor: borderColor || "rgba(255,255,255,0.24)",
          borderWidth: borderColor ? 2.5 : 1.5,
        },
      ]}
    >
      {item?.avatarUrl ? (
        <Image source={{ uri: item.avatarUrl }} style={StyleSheet.absoluteFill} />
      ) : isFamily ? (
        <Ionicons name={item?.familyIcon || "people"} size={Math.round(size * 0.46)} color="#FFFFFF" />
      ) : (
        <Text style={[styles.avatarInitial, { fontSize: Math.round(size * 0.4) }]}>
          {(item?.name || "S").charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
});

const PodiumSlot = memo(function PodiumSlot({
  item,
  place,
  tabKey,
  isSelf,
  onPress,
}) {
  const theme = MEDAL_THEME[place] || MEDAL_THEME[3];
  const isFamily = tabKey === "activeFamilies";
  const isFirst = place === 1;

  if (!item) {
    return <View style={styles.podiumSlot} />;
  }

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`${place}. sıra ${item.name}`}
      style={({ pressed }) => [
        styles.podiumSlot,
        isFirst && styles.podiumSlotFirst,
        pressed && { opacity: 0.86, transform: [{ scale: 0.97 }] },
      ]}
    >
      <View style={styles.podiumMedalTop}>
        <MaterialCommunityIcons name={theme.icon} size={isFirst ? 22 : 17} color={theme.ring} />
      </View>

      <View style={styles.podiumAvatarHolder}>
        <EntityAvatar
          item={item}
          size={theme.avatarSize}
          borderColor={theme.ring}
          isFamily={isFamily}
        />
        <View
          style={[
            styles.podiumRankBadge,
            { backgroundColor: theme.ring },
          ]}
        >
          <Text style={styles.podiumRankBadgeText}>{place}</Text>
        </View>
      </View>

      <Text
        numberOfLines={2}
        style={[
          styles.podiumName,
          isFirst && styles.podiumNameFirst,
          isSelf && { color: "#93C5FD" },
        ]}
      >
        {isSelf ? `${item.name} (${isFamily ? "Ailen" : "Sen"})` : item.name}
      </Text>

      <View
        style={[
          styles.podiumScorePill,
          { backgroundColor: theme.badgeBg, borderColor: theme.badgeBorder },
        ]}
      >
        {tabKey === "mostGenerous" ? (
          <Ionicons name="diamond" size={10} color={theme.text} />
        ) : tabKey === "activeFamilies" ? (
          <Ionicons name="flame" size={10} color={theme.text} />
        ) : (
          <Ionicons name="star" size={10} color={theme.text} />
        )}
        <Text numberOfLines={1} style={[styles.podiumScoreText, { color: theme.text }]}>
          {formatPrimaryMetric(tabKey, item)}
        </Text>
      </View>

      <LinearGradient
        colors={theme.pedestal}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[
          styles.podiumPedestal,
          { height: theme.pedestalHeight, borderColor: theme.badgeBorder },
        ]}
      >
        <Text style={[styles.podiumPedestalNum, { color: theme.ring }]}>#{place}</Text>
        {tabKey === "activeFamilies" ? (
          <Text numberOfLines={1} style={styles.podiumPedestalMeta}>
            Sv.{item.level} · {item.memberCount ?? 0} üye
          </Text>
        ) : tabKey === "topLevels" ? (
          <Text numberOfLines={1} style={styles.podiumPedestalMeta}>
            {fmtCompact(item.secondaryScore)} XP
          </Text>
        ) : (
          <Text numberOfLines={1} style={styles.podiumPedestalMeta}>
            Sv. {item.level}
          </Text>
        )}
      </LinearGradient>
    </Pressable>
  );
});

const LeaderboardRow = memo(function LeaderboardRow({
  item,
  tabKey,
  accent,
  isSelf,
  onPress,
}) {
  const isFamily = tabKey === "activeFamilies";
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.rank}. ${item.name}`}
      style={({ pressed }) => [
        styles.rowCard,
        isSelf && styles.rowCardSelf,
        pressed && styles.rowCardPressed,
      ]}
    >
      <View style={styles.rowRankBox}>
        <Text style={[styles.rowRankText, isSelf && { color: "#93C5FD" }]}>
          {item.rank}
        </Text>
      </View>

      <EntityAvatar
        item={item}
        size={40}
        borderColor={isSelf ? "#60A5FA" : "rgba(255,255,255,0.18)"}
        isFamily={isFamily}
      />

      <View style={styles.rowCopy}>
        <View style={styles.rowTitleLine}>
          <Text numberOfLines={1} style={[styles.rowName, isSelf && { color: "#BFDBFE" }]}>
            {isSelf ? `${item.name} (${isFamily ? "Ailen" : "Sen"})` : item.name}
          </Text>
          {tabKey === "mostGenerous" && item.score > 0 ? (
            <SoraWealthBadge spent={item.score} size="xs" animated={false} />
          ) : tabKey === "topLevels" ? (
            <SoraLevelCrest level={item.level} size={18} />
          ) : null}
        </View>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {formatSecondaryLine(tabKey, item)}
        </Text>
      </View>

      <View style={[styles.rowScorePill, { borderColor: `${accent}44`, backgroundColor: `${accent}1A` }]}>
        {tabKey === "mostGenerous" ? (
          <Ionicons name="diamond" size={11} color={accent} />
        ) : tabKey === "activeFamilies" ? (
          <Ionicons name="flame" size={11} color={accent} />
        ) : (
          <Ionicons name="star" size={11} color={accent} />
        )}
        <Text numberOfLines={1} style={[styles.rowScoreText, { color: accent }]}>
          {formatPrimaryMetric(tabKey, item)}
        </Text>
      </View>
    </Pressable>
  );
});

export const GlobalLeaderboardSheet = memo(function GlobalLeaderboardSheet({
  visible,
  currentUserId = null,
  myFamilyId = null,
  onSelectUser,
  onSelectFamily,
  onDismiss,
}) {
  resetLeaderboardCacheIfUserChanged(currentUserId);
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState("mostGenerous");
  const [data, setData] = useState(() => cachedLeaderboardData || {
    mostGenerous: [],
    activeFamilies: [],
    topLevels: [],
  });
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchBoard = useCallback(async ({ force = false } = {}) => {
    const hasFreshCache =
      !force && cachedLeaderboardData && Date.now() - cachedLeaderboardAt < CACHE_TTL_MS;
    if (hasFreshCache) {
      setData(cachedLeaderboardData);
      setError("");
      return;
    }
    const showInitialSpinner = !cachedLeaderboardData;
    if (showInitialSpinner) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const next = await getGlobalLeaderboard(50);
      cachedLeaderboardData = next;
      cachedLeaderboardAt = Date.now();
      setData(next);
    } catch (err) {
      if (!cachedLeaderboardData) {
        setError(err?.message || "Sıralama şu an yüklenemedi.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    fetchBoard({ force: false });
  }, [fetchBoard, visible]);

  const activeTabMeta = useMemo(
    () => TABS.find((t) => t.key === activeTab) || TABS[0],
    [activeTab],
  );

  const items = useMemo(
    () => (Array.isArray(data?.[activeTab]) ? data[activeTab] : []),
    [activeTab, data],
  );

  const topThree = useMemo(() => items.slice(0, 3), [items]);
  const restItems = useMemo(() => items.slice(3), [items]);

  const myEntry = useMemo(() => {
    if (activeTab === "activeFamilies") {
      if (!myFamilyId) return null;
      return items.find((item) => item.entityId === myFamilyId) || null;
    }
    if (!currentUserId) return null;
    return items.find((item) => item.entityId === currentUserId) || null;
  }, [activeTab, currentUserId, items, myFamilyId]);

  const handlePressItem = useCallback(
    (item) => {
      if (!item?.entityId) return;
      if (item.entityType === "family") {
        onSelectFamily?.(item.entityId);
      } else {
        onSelectUser?.(item.entityId);
      }
    },
    [onSelectFamily, onSelectUser],
  );

  const isEntrySelf = useCallback(
    (item) => {
      if (!item?.entityId) return false;
      if (activeTab === "activeFamilies") return Boolean(myFamilyId && item.entityId === myFamilyId);
      return Boolean(currentUserId && item.entityId === currentUserId);
    },
    [activeTab, currentUserId, myFamilyId],
  );

  const keyExtractor = useCallback(
    (item) => `${item.category}:${item.entityId}:${item.rank}`,
    [],
  );

  const renderRow = useCallback(
    ({ item }) => (
      <LeaderboardRow
        item={item}
        tabKey={activeTab}
        accent={activeTabMeta.accent}
        isSelf={isEntrySelf(item)}
        onPress={handlePressItem}
      />
    ),
    [activeTab, activeTabMeta.accent, handlePressItem, isEntrySelf],
  );

  const renderHeader = useCallback(() => {
    if (!topThree.length) return null;
    return (
      <View style={styles.podiumCard}>
        <LinearGradient
          colors={["rgba(251,191,36,0.12)", "rgba(47,128,237,0.08)", "rgba(15,23,42,0.2)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.podiumRow}>
          <PodiumSlot
            item={topThree[1] || null}
            place={2}
            tabKey={activeTab}
            isSelf={isEntrySelf(topThree[1])}
            onPress={handlePressItem}
          />
          <PodiumSlot
            item={topThree[0] || null}
            place={1}
            tabKey={activeTab}
            isSelf={isEntrySelf(topThree[0])}
            onPress={handlePressItem}
          />
          <PodiumSlot
            item={topThree[2] || null}
            place={3}
            tabKey={activeTab}
            isSelf={isEntrySelf(topThree[2])}
            onPress={handlePressItem}
          />
        </View>
      </View>
    );
  }, [activeTab, handlePressItem, isEntrySelf, topThree]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.screen}>
        <StatusBar barStyle="light-content" backgroundColor="#0A1120" />
        <LinearGradient
          colors={["#0A1120", "#111D35", "#0B1324"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Header */}
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 14) + 6 }]}>
          <View style={styles.headerTitleWrap}>
            <View style={styles.trophyOrb}>
              <Ionicons name="trophy" size={19} color="#FBBF24" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                Liderlik Podyumu
              </Text>
              <Text style={styles.headerSub} numberOfLines={1}>
                Sora global sıralaması · dokun ve incele
              </Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => fetchBoard({ force: true })}
              disabled={loading || refreshing}
              accessibilityRole="button"
              accessibilityLabel="Sıralamayı yenile"
              style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.75 }]}
            >
              {refreshing ? (
                <ActivityIndicator size="small" color="#FBBF24" />
              ) : (
                <Ionicons name="refresh" size={18} color="#CBD5E1" />
              )}
            </Pressable>
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Liderlik podyumunu kapat"
              style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.75 }]}
            >
              <Ionicons name="close" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>

        {/* 3 Equal Segmented Tabs */}
        <View style={styles.tabBar}>
          {TABS.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.tabItem,
                  active && [styles.tabItemActive, { borderColor: `${tab.accent}66` }],
                  pressed && { opacity: 0.88 },
                ]}
              >
                <Ionicons
                  name={tab.icon}
                  size={13}
                  color={active ? tab.accent : "#8AA0BF"}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.tabLabel,
                    active && { color: "#FFFFFF" },
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Content */}
        {loading && !items.length ? (
          <View style={styles.stateCenter}>
            <ActivityIndicator size="large" color="#FBBF24" />
            <Text style={styles.stateTitle}>Podyum hazırlanıyor…</Text>
          </View>
        ) : error && !items.length ? (
          <View style={styles.stateCenter}>
            <Ionicons name="cloud-offline-outline" size={34} color="#8AA0BF" />
            <Text style={styles.stateTitle}>Sıralama yüklenemedi</Text>
            <Text style={styles.stateCopy}>{error}</Text>
            <Pressable
              onPress={() => fetchBoard({ force: true })}
              style={styles.retryBtn}
              accessibilityRole="button"
            >
              <Text style={styles.retryBtnText}>Tekrar Dene</Text>
            </Pressable>
          </View>
        ) : !items.length ? (
          <View style={styles.stateCenter}>
            <MaterialCommunityIcons name="trophy-outline" size={38} color="#647D9E" />
            <Text style={styles.stateTitle}>Henüz sıralama oluşmadı</Text>
            <Text style={styles.stateCopy}>
              {activeTab === "mostGenerous"
                ? "İlk hediyeler gönderildiğinde cömertlik zirvesi burada parlar."
                : activeTab === "activeFamilies"
                  ? "Aileler kurulduğunda en aktif aileler burada yarışır."
                  : "Seviye kazandıkça zirvedeki yerini al."}
            </Text>
          </View>
        ) : (
          <FlatList
            data={restItems}
            keyExtractor={keyExtractor}
            renderItem={renderRow}
            ListHeaderComponent={renderHeader}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 10,
              paddingBottom: Math.max(insets.bottom, 16) + (myEntry ? 82 : 20),
              gap: 8,
            }}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
          />
        )}

        {/* Sticky self rank bar when user or their family is ranked */}
        {myEntry ? (
          <View
            style={[
              styles.myRankFooter,
              { paddingBottom: Math.max(insets.bottom, 12) },
            ]}
          >
            <Pressable
              onPress={() => handlePressItem(myEntry)}
              style={({ pressed }) => [styles.myRankPill, pressed && { opacity: 0.9 }]}
            >
              <View style={styles.myRankBadge}>
                <Text style={styles.myRankBadgeText}>#{myEntry.rank}</Text>
              </View>
              <EntityAvatar
                item={myEntry}
                size={32}
                borderColor={activeTabMeta.accent}
                isFamily={activeTab === "activeFamilies"}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={styles.myRankTitle}>
                  {activeTab === "activeFamilies" ? `Ailen: ${myEntry.name}` : `Senin Sıran · ${myEntry.name}`}
                </Text>
                <Text numberOfLines={1} style={styles.myRankSub}>
                  {formatSecondaryLine(activeTab, myEntry)}
                </Text>
              </View>
              <Text style={[styles.myRankScore, { color: activeTabMeta.accent }]}>
                {formatPrimaryMetric(activeTab, myEntry)}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0A1120",
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  trophyOrb: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "rgba(251,191,36,0.16)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.38)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  headerSub: {
    color: "#8AA0BF",
    fontSize: 11.5,
    fontWeight: "600",
    marginTop: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  tabBar: {
    marginHorizontal: 16,
    marginBottom: 8,
    height: 44,
    padding: 4,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    flexDirection: "row",
    gap: 5,
  },
  tabItem: {
    flex: 1,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: "transparent",
  },
  tabItemActive: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  tabLabel: {
    color: "#94A8C4",
    fontSize: 10.5,
    fontWeight: "800",
  },
  podiumCard: {
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.22)",
    backgroundColor: "rgba(18,30,52,0.85)",
    paddingTop: 14,
    paddingHorizontal: 10,
    paddingBottom: 12,
    marginBottom: 8,
  },
  podiumRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
  },
  podiumSlot: {
    flex: 1,
    alignItems: "center",
    paddingTop: 14,
  },
  podiumSlotFirst: {
    paddingTop: 0,
  },
  podiumMedalTop: {
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  podiumAvatarHolder: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  avatarWrap: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  podiumRankBadge: {
    position: "absolute",
    bottom: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#111D35",
  },
  podiumRankBadgeText: {
    color: "#0A1120",
    fontSize: 10,
    fontWeight: "900",
  },
  podiumName: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    minHeight: 20,
    lineHeight: 15,
    marginTop: 2,
  },
  podiumNameFirst: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  podiumScorePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 4,
    marginBottom: 8,
    maxWidth: "100%",
  },
  podiumScoreText: {
    fontSize: 10.5,
    fontWeight: "900",
  },
  podiumPedestal: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  podiumPedestalNum: {
    fontSize: 14,
    fontWeight: "900",
  },
  podiumPedestalMeta: {
    color: "#94A8C4",
    fontSize: 9.5,
    fontWeight: "700",
    marginTop: 1,
  },
  rowCard: {
    minHeight: 64,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowCardSelf: {
    backgroundColor: "rgba(47,128,237,0.16)",
    borderColor: "rgba(96,165,250,0.45)",
  },
  rowCardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  rowRankBox: {
    width: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  rowRankText: {
    color: "#8AA0BF",
    fontSize: 13,
    fontWeight: "900",
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  rowName: {
    color: "#F8FAFC",
    fontSize: 13.5,
    fontWeight: "800",
    flexShrink: 1,
  },
  rowMeta: {
    color: "#8AA0BF",
    fontSize: 11.5,
    fontWeight: "600",
    marginTop: 2,
  },
  rowScorePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 11,
    borderWidth: 1,
    flexShrink: 0,
  },
  rowScoreText: {
    fontSize: 11.5,
    fontWeight: "900",
  },
  stateCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 8,
  },
  stateTitle: {
    color: "#F8FAFC",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 4,
  },
  stateCopy: {
    color: "#8AA0BF",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 13,
    backgroundColor: "#2F80ED",
  },
  retryBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  myRankFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: "rgba(10,17,32,0.92)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.09)",
  },
  myRankPill: {
    minHeight: 50,
    borderRadius: 15,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(47,128,237,0.18)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.42)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  myRankBadge: {
    minWidth: 32,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 9,
    backgroundColor: "rgba(251,191,36,0.18)",
    alignItems: "center",
  },
  myRankBadgeText: {
    color: "#FDE68A",
    fontSize: 12,
    fontWeight: "900",
  },
  myRankTitle: {
    color: "#FFFFFF",
    fontSize: 12.5,
    fontWeight: "800",
  },
  myRankSub: {
    color: "#94A8C4",
    fontSize: 11,
    fontWeight: "600",
  },
  myRankScore: {
    fontSize: 12.5,
    fontWeight: "900",
  },
});
