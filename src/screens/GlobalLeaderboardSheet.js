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

const PODIUM_GLOW = require("../../assets/events/podium-glow.webp");

const TABS = [
  { key: "mostGenerous", label: "En Cömertler", icon: "diamond", accent: "#E2BE79" },
  { key: "activeFamilies", label: "Aktif Aileler", icon: "people", accent: "#93C5FD" },
  { key: "topLevels", label: "Zirve Seviye", icon: "star", accent: "#93C5FD" },
];

const MEDAL_THEME = {
  1: {
    ring: "#E2BE79",
    badgeBg: "rgba(226,190,121,0.14)",
    badgeBorder: "rgba(226,190,121,0.72)",
    pedestal: ["rgba(226,190,121,0.16)", "rgba(226,190,121,0.02)"],
    text: "#EAD09B",
    lvlText: "#F3D99B",
    avatarSize: 66,
    pedestalHeight: 56,
  },
  2: {
    ring: "#CBD5E1",
    badgeBg: "rgba(203,213,225,0.10)",
    badgeBorder: "rgba(203,213,225,0.50)",
    pedestal: ["rgba(255,255,255,0.075)", "rgba(255,255,255,0.015)"],
    text: "#9FB2CA",
    lvlText: "#CBD5E1",
    avatarSize: 52,
    pedestalHeight: 42,
  },
  3: {
    ring: "#D49C72",
    badgeBg: "rgba(212,156,114,0.10)",
    badgeBorder: "rgba(212,156,114,0.50)",
    pedestal: ["rgba(255,255,255,0.065)", "rgba(255,255,255,0.015)"],
    text: "#9FB2CA",
    lvlText: "#CBD5E1",
    avatarSize: 52,
    pedestalHeight: 34,
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
        {isFirst ? (
          <MaterialCommunityIcons name="crown-outline" size={18} color="#E2BE79" />
        ) : null}
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
        numberOfLines={1}
        style={[
          styles.podiumName,
          isFirst && styles.podiumNameFirst,
          isSelf && { color: "#93C5FD" },
        ]}
      >
        {isSelf ? `${item.name} (${isFamily ? "Ailen" : "Sen"})` : item.name}
      </Text>

      <Text numberOfLines={1} style={[styles.podiumScoreText, { color: theme.text }]}>
        {formatPrimaryMetric(tabKey, item)}
      </Text>

      <LinearGradient
        colors={theme.pedestal}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[
          styles.podiumPedestal,
          { height: theme.pedestalHeight, borderTopColor: theme.badgeBorder },
        ]}
      >
        {tabKey === "activeFamilies" ? (
          <Text numberOfLines={1} style={[styles.podiumPedestalMeta, { color: theme.lvlText }]}>
            Sv. {item.level} · {item.memberCount ?? 0} üye
          </Text>
        ) : tabKey === "topLevels" ? (
          <Text numberOfLines={1} style={[styles.podiumPedestalMeta, { color: theme.lvlText }]}>
            {fmtCompact(item.secondaryScore)} XP
          </Text>
        ) : (
          <Text numberOfLines={1} style={[styles.podiumPedestalMeta, { color: theme.lvlText }]}>
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
        size={38}
        borderColor={isSelf ? "#60A5FA" : "rgba(255,255,255,0.12)"}
        isFamily={isFamily}
      />

      <View style={styles.rowCopy}>
        <View style={styles.rowTitleLine}>
          <Text numberOfLines={1} style={[styles.rowName, isSelf && { color: "#DBEAFE" }]}>
            {isSelf ? `${item.name} (${isFamily ? "Ailen" : "Sen"})` : item.name}
          </Text>
          {!isFamily ? (
            <SoraLevelCrest level={item.level} size={16} />
          ) : null}
        </View>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {formatSecondaryLine(tabKey, item)}
        </Text>
      </View>

      <Text numberOfLines={1} style={[styles.rowScoreText, { color: isSelf ? "#93C5FD" : accent }]}>
        {formatPrimaryMetric(tabKey, item)}
      </Text>
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
        <Image
          source={PODIUM_GLOW}
          resizeMode="contain"
          tintColor="#60A5FA"
          style={styles.podiumGlowImg}
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
        <StatusBar barStyle="light-content" backgroundColor="#101C33" />
        <LinearGradient
          colors={["#101C33", "#0C1424", "#09101C"]}
          locations={[0, 0.44, 1]}
          style={StyleSheet.absoluteFill}
        />

        {/* Header */}
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 14) + 6 }]}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Liderlik
          </Text>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => fetchBoard({ force: true })}
              disabled={loading || refreshing}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Sıralamayı yenile"
              style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.65 }]}
            >
              {refreshing ? (
                <ActivityIndicator size="small" color="#93C5FD" />
              ) : (
                <Ionicons name="refresh" size={19} color="#CBD5E1" />
              )}
            </Pressable>
            <Pressable
              onPress={onDismiss}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Liderlik podyumunu kapat"
              style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.65 }]}
            >
              <Ionicons name="close" size={21} color="#CBD5E1" />
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
                  active && styles.tabItemActive,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.tabLabel,
                    active && styles.tabLabelActive,
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
            <ActivityIndicator size="large" color="#93C5FD" />
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
          <View style={styles.listShell}>
            {renderHeader()}
            <View style={styles.listTray}>
              <FlatList
                data={restItems}
                keyExtractor={keyExtractor}
                renderItem={renderRow}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 16,
                  paddingTop: 6,
                  paddingBottom: Math.max(insets.bottom, 16) + (myEntry ? 84 : 20),
                }}
                initialNumToRender={12}
                maxToRenderPerBatch={10}
                windowSize={7}
              />
            </View>
          </View>
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
              <Text style={styles.myRankBadgeText}>#{myEntry.rank}</Text>
              <EntityAvatar
                item={myEntry}
                size={34}
                borderColor="rgba(147,197,253,0.45)"
                isFamily={activeTab === "activeFamilies"}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={styles.myRankTitle}>
                  {activeTab === "activeFamilies" ? `${myEntry.name} (Ailen)` : `${myEntry.name} (Sen)`}
                </Text>
                <Text numberOfLines={1} style={styles.myRankSub}>
                  Kendi sıran · {formatSecondaryLine(activeTab, myEntry)}
                </Text>
              </View>
              <Text style={styles.myRankScore}>
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
    backgroundColor: "#09101C",
  },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  headerTitle: {
    color: "#F8FAFC",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.45,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBar: {
    marginHorizontal: 16,
    marginBottom: 12,
    height: 42,
    padding: 4,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.055)",
    flexDirection: "row",
    gap: 4,
  },
  tabItem: {
    flex: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  tabItemActive: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  tabLabel: {
    color: "#8EA3BF",
    fontSize: 11.5,
    fontWeight: "600",
  },
  tabLabelActive: {
    color: "#F8FAFC",
    fontWeight: "700",
  },
  listShell: {
    flex: 1,
  },
  podiumCard: {
    paddingTop: 4,
    paddingHorizontal: 16,
    paddingBottom: 0,
    position: "relative",
    overflow: "visible",
  },
  podiumGlowImg: {
    position: "absolute",
    top: -10,
    alignSelf: "center",
    width: 210,
    height: 130,
    opacity: 0.22,
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
    flex: 1.12,
    paddingTop: 0,
  },
  podiumMedalTop: {
    height: 20,
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
    fontWeight: "800",
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
    borderColor: "#0E1729",
  },
  podiumRankBadgeText: {
    color: "#0B1220",
    fontSize: 10,
    fontWeight: "800",
  },
  podiumName: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 2,
  },
  podiumNameFirst: {
    color: "#F8FAFC",
    fontSize: 12.5,
    fontWeight: "800",
  },
  podiumScoreText: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
    marginBottom: 9,
    fontVariant: ["tabular-nums"],
  },
  podiumPedestal: {
    width: "100%",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderTopWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  podiumPedestalMeta: {
    fontSize: 10.5,
    fontWeight: "700",
  },
  listTray: {
    flex: 1,
    backgroundColor: "#101A2E",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.075)",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  rowCard: {
    minHeight: 58,
    paddingHorizontal: 2,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.055)",
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  rowCardSelf: {
    backgroundColor: "rgba(59,130,246,0.10)",
    marginHorizontal: -6,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderBottomColor: "transparent",
  },
  rowCardPressed: {
    opacity: 0.78,
  },
  rowRankBox: {
    width: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  rowRankText: {
    color: "#7C92AF",
    fontSize: 12.5,
    fontWeight: "700",
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowName: {
    color: "#F1F5F9",
    fontSize: 13.5,
    fontWeight: "600",
    flexShrink: 1,
  },
  rowMeta: {
    color: "#7C92AF",
    fontSize: 11,
    fontWeight: "500",
    marginTop: 2,
  },
  rowScoreText: {
    fontSize: 12.5,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
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
    fontWeight: "800",
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
    backgroundColor: "#2563EB",
  },
  retryBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  myRankFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: "rgba(16,26,46,0.95)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
  },
  myRankPill: {
    minHeight: 52,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: "rgba(59,130,246,0.14)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.28)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  myRankBadgeText: {
    minWidth: 26,
    textAlign: "center",
    color: "#93C5FD",
    fontSize: 13,
    fontWeight: "800",
  },
  myRankTitle: {
    color: "#DBEAFE",
    fontSize: 13,
    fontWeight: "700",
  },
  myRankSub: {
    color: "#93C5FD",
    fontSize: 11,
    fontWeight: "500",
    marginTop: 1,
  },
  myRankScore: {
    color: "#93C5FD",
    fontSize: 12.5,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
