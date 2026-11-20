import { memo, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../auth/supabase";
import { playSfx } from "../audio/SoraSfx";

const TR_NUM_FMT = new Intl.NumberFormat("tr-TR");
const fmtNum = (n) =>
  TR_NUM_FMT.format(Math.max(0, Math.floor(Number(n) || 0)));

const fmtShort = (n) => {
  const v = Number(n) || 0;
  if (v >= 1000) {
    const k = v / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1).replace(".", ",")}B`;
  }
  return String(v);
};

let cachedStatus = null;
const statusListeners = new Set();

const broadcastStatus = (next) => {
  cachedStatus = next;
  statusListeners.forEach((fn) => {
    try {
      fn(next);
    } catch {}
  });
};

export async function refreshDailyMissionsStatus() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("get_daily_missions_status");
    if (error || !data) return null;
    broadcastStatus(data);
    return data;
  } catch {
    return null;
  }
}

export function bumpMissionProgress(missionKey, delta = 1) {
  if (!supabase || !missionKey) return;
  supabase
    .rpc("bump_daily_mission", {
      p_mission_key: missionKey,
      p_delta: Math.max(1, Math.floor(Number(delta) || 1)),
    })
    .then(({ data }) => {
      if (data?.completed && !data?.claimed) {
        refreshDailyMissionsStatus();
      }
    })
    .catch(() => undefined);
}

export function countClaimableRewards(status) {
  if (!status) return 0;
  let total = status.streak_claimed_today ? 0 : 1;
  if (Array.isArray(status.missions)) {
    for (const m of status.missions) {
      if (!m.claimed && Number(m.progress) >= Number(m.target)) total += 1;
    }
  }
  return total;
}

export function useDailyMissionsBadge(enabled = true) {
  const [status, setStatus] = useState(cachedStatus);

  useEffect(() => {
    if (!enabled) return undefined;
    statusListeners.add(setStatus);
    if (!cachedStatus) {
      refreshDailyMissionsStatus();
    } else {
      setStatus(cachedStatus);
    }
    return () => {
      statusListeners.delete(setStatus);
    };
  }, [enabled]);

  return {
    status,
    claimableCount: countClaimableRewards(status),
    refresh: refreshDailyMissionsStatus,
  };
}

export const DailyMissionsSheet = memo(function DailyMissionsSheet({
  visible,
  onDismiss,
  onBalanceUpdate,
}) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState(cachedStatus);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const next = await refreshDailyMissionsStatus();
    if (next) setStatus(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!visible) {
      setToast(null);
      return;
    }
    load();
  }, [load, visible]);

  const showToast = useCallback((text) => {
    setToast(text);
    setTimeout(() => {
      setToast((curr) => (curr === text ? null : curr));
    }, 2600);
  }, []);

  const handleClaimStreak = async () => {
    if (!supabase || busyKey) return;
    setBusyKey("streak");
    try {
      const { data, error } = await supabase.rpc("claim_streak_bonus");
      if (error) throw error;
      if (data && !data.already_claimed && Number(data.reward) > 0) {
        playSfx("coin");
        if (typeof data.balance === "number") onBalanceUpdate?.(data.balance);
        showToast(`+${fmtNum(data.reward)} kredi (${data.streak_day}. gün serisi)`);
      }
      await load();
    } catch (err) {
      showToast(err?.message || "Seri ödülü alınamadı");
    } finally {
      setBusyKey(null);
    }
  };

  const handleClaimMission = async (mission) => {
    if (!supabase || busyKey || !mission?.key) return;
    setBusyKey(mission.key);
    try {
      const { data, error } = await supabase.rpc("claim_daily_mission", {
        p_mission_key: mission.key,
      });
      if (error) throw error;
      if (data && !data.already_claimed && Number(data.reward) > 0) {
        playSfx("coin");
        if (typeof data.balance === "number") onBalanceUpdate?.(data.balance);
        showToast(`+${fmtNum(data.reward)} kredi kazanıldı!`);
      }
      await load();
    } catch (err) {
      showToast(err?.message || "Ödül alınamadı");
    } finally {
      setBusyKey(null);
    }
  };

  const streakRewards = Array.isArray(status?.streak_rewards)
    ? status.streak_rewards
    : [1500, 2500, 4000, 6000, 8500, 12000, 25000];
  const streakDay = Number(status?.streak_day || 0);
  const streakClaimed = Boolean(status?.streak_claimed_today);
  const nextStreakDay = Number(status?.next_streak_day || 1);
  const missions = Array.isArray(status?.missions) ? status.missions : [];

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Kapat" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 10 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Görevler & Giriş Serisi</Text>
              <Text style={styles.subtitle}>
                Her gün gel, seri bonusunu katla ve görevlerden kredi kazan
              </Text>
            </View>
            <Pressable onPress={onDismiss} style={styles.closeBtn} accessibilityRole="button">
              <Ionicons name="close" size={18} color="#DCE8FA" />
            </Pressable>
          </View>

          {toast ? (
            <View style={styles.toast}>
              <Ionicons name="sparkles" size={14} color="#FDE68A" />
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          ) : null}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* 7 Günlük Giriş Serisi */}
            <LinearGradient
              colors={["#1B2B4B", "#111B31"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.streakCard}
            >
              <View style={styles.streakHead}>
                <View style={styles.streakTitleRow}>
                  <MaterialCommunityIcons name="fire" size={18} color="#FBBF24" />
                  <Text style={styles.streakTitle}>7 Günlük Giriş Serisi</Text>
                </View>
                <Text style={styles.streakBadge}>
                  {streakDay > 0 ? `${streakDay}/7 Gün` : "Yeni Seri"}
                </Text>
              </View>

              <View style={styles.daysRow}>
                {streakRewards.map((amt, idx) => {
                  const day = idx + 1;
                  const done = day <= streakDay;
                  const isTodayTarget = !streakClaimed && day === nextStreakDay;
                  const isGrand = day === 7;
                  return (
                    <View
                      key={day}
                      style={[
                        styles.dayBox,
                        done && styles.dayBoxDone,
                        isTodayTarget && styles.dayBoxCurrent,
                        isGrand && styles.dayBoxGrand,
                      ]}
                    >
                      <Text style={styles.dayNum}>{day}.G</Text>
                      {done ? (
                        <Ionicons name="checkmark-circle" size={15} color="#4ADE80" />
                      ) : isGrand ? (
                        <MaterialCommunityIcons name="treasure-chest" size={15} color="#FDE047" />
                      ) : (
                        <Ionicons
                          name="diamond"
                          size={12}
                          color={isTodayTarget ? "#FDE047" : "#93C5FD"}
                        />
                      )}
                      <Text
                        style={[
                          styles.dayReward,
                          isGrand && { color: "#FDE047" },
                          done && { color: "#86EFAC" },
                        ]}
                        numberOfLines={1}
                      >
                        {fmtShort(amt)}
                      </Text>
                    </View>
                  );
                })}
              </View>

              <Pressable
                disabled={streakClaimed || busyKey === "streak" || loading}
                onPress={handleClaimStreak}
                style={({ pressed }) => [
                  styles.streakCta,
                  streakClaimed && styles.streakCtaDone,
                  pressed && !streakClaimed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
                ]}
              >
                {busyKey === "streak" ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons
                      name={streakClaimed ? "checkmark-circle" : "gift"}
                      size={16}
                      color={streakClaimed ? "#86EFAC" : "#111827"}
                    />
                    <Text style={[styles.streakCtaText, streakClaimed && styles.streakCtaTextDone]}>
                      {streakClaimed
                        ? "Bugünün seri ödülü alındı"
                        : `${nextStreakDay}. Gün Ödülünü Al (+${fmtNum(streakRewards[nextStreakDay - 1] || 1500)})`}
                    </Text>
                  </>
                )}
              </Pressable>
            </LinearGradient>

            {/* Günlük Görevler */}
            <Text style={styles.sectionLabel}>GÜNLÜK GÖREVLER</Text>

            {loading && missions.length === 0 ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color="#60A5FA" />
              </View>
            ) : (
              missions.map((m) => {
                const prog = Math.min(m.target, Number(m.progress) || 0);
                const ratio = m.target > 0 ? prog / m.target : 0;
                const ready = !m.claimed && prog >= m.target;
                return (
                  <View key={m.key} style={styles.missionRow}>
                    <View style={[styles.missionIcon, ready && styles.missionIconReady]}>
                      <Ionicons
                        name={m.icon || "sparkles"}
                        size={19}
                        color={m.claimed ? "#86EFAC" : ready ? "#FEF08A" : "#93C5FD"}
                      />
                    </View>
                    <View style={styles.missionBody}>
                      <View style={styles.missionTop}>
                        <Text style={styles.missionTitle} numberOfLines={1}>
                          {m.title}
                        </Text>
                        <Text style={styles.missionCount}>
                          {prog}/{m.target}
                        </Text>
                      </View>
                      <Text style={styles.missionDesc} numberOfLines={1}>
                        {m.description}
                      </Text>
                      <View style={styles.missionTrack}>
                        <View
                          style={[
                            styles.missionFill,
                            { width: `${Math.max(4, Math.round(ratio * 100))}%` },
                            m.claimed && { backgroundColor: "#4ADE80" },
                            ready && { backgroundColor: "#FBBF24" },
                          ]}
                        />
                      </View>
                    </View>
                    <Pressable
                      disabled={!ready || busyKey === m.key}
                      onPress={() => handleClaimMission(m)}
                      style={[
                        styles.claimBtn,
                        ready && styles.claimBtnReady,
                        m.claimed && styles.claimBtnDone,
                      ]}
                    >
                      {busyKey === m.key ? (
                        <ActivityIndicator size="small" color="#111827" />
                      ) : (
                        <Text
                          style={[
                            styles.claimBtnText,
                            ready && styles.claimBtnTextReady,
                            m.claimed && styles.claimBtnTextDone,
                          ]}
                        >
                          {m.claimed ? "Alındı" : ready ? `+${fmtShort(m.reward)}` : fmtShort(m.reward)}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(4,10,20,0.68)",
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    backgroundColor: "#0E182B",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: "rgba(124,179,255,0.22)",
    paddingHorizontal: 16,
    paddingTop: 10,
    maxHeight: "84%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(148,176,212,0.35)",
    alignSelf: "center",
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  subtitle: {
    color: "#94AFCF",
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(245,158,11,0.18)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.45)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  toastText: {
    color: "#FEF3C7",
    fontSize: 12.5,
    fontWeight: "800",
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: 10,
    gap: 10,
  },
  streakCard: {
    borderRadius: 18,
    padding: 13,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.28)",
  },
  streakHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  streakTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  streakTitle: {
    color: "#FFFFFF",
    fontSize: 14.5,
    fontWeight: "900",
  },
  streakBadge: {
    color: "#FDE68A",
    fontSize: 11.5,
    fontWeight: "800",
    backgroundColor: "rgba(251,191,36,0.16)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9,
  },
  daysRow: {
    flexDirection: "row",
    gap: 4,
    marginBottom: 12,
  },
  dayBox: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 2,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 3,
  },
  dayBoxDone: {
    backgroundColor: "rgba(34,197,94,0.14)",
    borderColor: "rgba(74,222,128,0.35)",
  },
  dayBoxCurrent: {
    backgroundColor: "rgba(251,191,36,0.18)",
    borderColor: "#FBBF24",
  },
  dayBoxGrand: {
    borderColor: "rgba(253,224,71,0.5)",
  },
  dayNum: {
    color: "#9BB4D6",
    fontSize: 9.5,
    fontWeight: "800",
  },
  dayReward: {
    color: "#E2EEFF",
    fontSize: 9.5,
    fontWeight: "900",
  },
  streakCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#FBBF24",
    borderRadius: 13,
    paddingVertical: 11,
  },
  streakCtaDone: {
    backgroundColor: "rgba(34,197,94,0.16)",
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.35)",
  },
  streakCtaText: {
    color: "#111827",
    fontSize: 13,
    fontWeight: "900",
  },
  streakCtaTextDone: {
    color: "#86EFAC",
  },
  sectionLabel: {
    color: "#8AA5C8",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginTop: 4,
  },
  loadingWrap: {
    paddingVertical: 24,
    alignItems: "center",
  },
  missionRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(148,184,230,0.14)",
    padding: 11,
    gap: 10,
  },
  missionIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "rgba(47,128,237,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  missionIconReady: {
    backgroundColor: "rgba(251,191,36,0.22)",
  },
  missionBody: {
    flex: 1,
    minWidth: 0,
  },
  missionTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  missionTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    flex: 1,
  },
  missionCount: {
    color: "#93C5FD",
    fontSize: 11,
    fontWeight: "800",
  },
  missionDesc: {
    color: "#8EA9CB",
    fontSize: 11,
    marginTop: 1,
  },
  missionTrack: {
    marginTop: 6,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  missionFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: "#3B82F6",
  },
  claimBtn: {
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  claimBtnReady: {
    backgroundColor: "#FBBF24",
  },
  claimBtnDone: {
    backgroundColor: "rgba(34,197,94,0.16)",
  },
  claimBtnText: {
    color: "#94AFCF",
    fontSize: 11.5,
    fontWeight: "800",
  },
  claimBtnTextReady: {
    color: "#111827",
    fontWeight: "900",
  },
  claimBtnTextDone: {
    color: "#86EFAC",
  },
});
