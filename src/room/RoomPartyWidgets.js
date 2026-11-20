import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../auth/supabase";
import { playSfx } from "../audio/SoraSfx";
import { SoraWealthBadge } from "../ui/SoraWealthTier";

const TR_NUM_FMT = new Intl.NumberFormat("tr-TR");
const fmtNum = (v) =>
  TR_NUM_FMT.format(Math.max(0, Math.floor(Number(v) || 0)));

const fmtShort = (v) => {
  const n = Math.max(0, Number(v) || 0);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "").replace(".", ",")} Mr`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "").replace(".", ",")} Mn`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "").replace(".", ",")} B`;
  return String(Math.floor(n));
};

const fmtMMSS = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

const makeUuid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

// ── 1) Oda Liderlik Kupası (Üst Bar Altı Mini Hap + Sıralama Penceresi) ──────
export const RoomTrophyPill = memo(function RoomTrophyPill({ totalCoins = 0, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.trophyPill, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Oda hediye sıralamasını aç"
    >
      <MaterialCommunityIcons name="trophy" size={13} color="#FDE047" />
      <Text style={styles.trophyText} numberOfLines={1}>
        {fmtShort(totalCoins)}
      </Text>
      <Ionicons name="chevron-forward" size={11} color="rgba(254,240,138,0.8)" />
    </Pressable>
  );
});

export const RoomLeaderboardSheet = memo(function RoomLeaderboardSheet({
  visible,
  roomId,
  roomTitle,
  currentUserId,
  onDismiss,
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ room_total: 0, rows: [] });

  useEffect(() => {
    if (!visible || !roomId || !supabase) return;
    let active = true;
    setLoading(true);
    supabase
      .rpc("get_room_gift_leaderboard", { p_room_id: roomId, p_limit: 20 })
      .then(({ data: res, error }) => {
        if (!active) return;
        if (!error && res) {
          setData({
            room_total: Number(res.room_total || 0),
            rows: Array.isArray(res.rows) ? res.rows : [],
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [roomId, visible]);

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Kapat" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 10 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Oda Hediye Sıralaması</Text>
              <Text style={styles.subtitle}>
                {roomTitle || "Oda"} · Toplam {fmtNum(data.room_total)} kredi
              </Text>
            </View>
            <Pressable onPress={onDismiss} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color="#DCE8FA" />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.centerPad}>
              <ActivityIndicator color="#FBBF24" />
            </View>
          ) : data.rows.length === 0 ? (
            <View style={styles.emptyBox}>
              <MaterialCommunityIcons name="trophy-outline" size={34} color="#647D9E" />
              <Text style={styles.emptyTitle}>Henüz hediye gönderilmedi</Text>
              <Text style={styles.emptySub}>İlk hediyeyi göndererek liderlik koltuğuna otur!</Text>
            </View>
          ) : (
            <ScrollView style={styles.scroll} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
              {data.rows.map((row) => {
                const isMe = row.user_id === currentUserId;
                const medalColor =
                  row.rank === 1
                    ? "#FBBF24"
                    : row.rank === 2
                      ? "#CBD5E1"
                      : row.rank === 3
                        ? "#FB923C"
                        : "#7D95B5";
                return (
                  <View key={row.user_id} style={[styles.lbRow, isMe && styles.lbRowMe]}>
                    <View style={styles.lbRank}>
                      {row.rank <= 3 ? (
                        <MaterialCommunityIcons
                          name={row.rank === 1 ? "crown" : "medal"}
                          size={18}
                          color={medalColor}
                        />
                      ) : (
                        <Text style={styles.lbRankText}>{row.rank}</Text>
                      )}
                    </View>
                    <View style={[styles.lbAvatar, { backgroundColor: row.avatar_color || "#2F80ED" }]}>
                      {row.avatar_url ? (
                        <Image source={{ uri: row.avatar_url }} style={StyleSheet.absoluteFill} />
                      ) : (
                        <Text style={styles.lbInitial}>
                          {(row.display_name || "S").charAt(0).toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.lbNameRow}>
                        <Text style={styles.lbName} numberOfLines={1}>
                          {isMe ? `${row.display_name} (Sen)` : row.display_name}
                        </Text>
                        <SoraWealthBadge spent={Number(row.gift_spent_total || 0)} size="xs" />
                      </View>
                      <Text style={styles.lbMeta}>
                        Sv. {row.user_level || 1} · {row.gift_count || 1} hediye
                      </Text>
                    </View>
                    <View style={styles.lbScorePill}>
                      <Ionicons name="diamond" size={11} color="#FDE047" />
                      <Text style={styles.lbScore}>{fmtShort(row.room_spent)}</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
});

// ── 2) Şanslı Paket (Lucky Packet: Yüzen Kutu + Oluşturma + Açma) ────────────
export const LuckyPacketBadge = memo(function LuckyPacketBadge({ packet, onPress }) {
  const [leftSec, setLeftSec] = useState(0);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!packet?.expires_at) return undefined;
    const calc = () => Math.max(0, Math.ceil((Date.parse(packet.expires_at) - Date.now()) / 1000));
    setLeftSec(calc());
    const t = setInterval(() => setLeftSec(calc()), 1000);
    return () => clearInterval(t);
  }, [packet?.expires_at]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 750, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  if (!packet || leftSec <= 0 || Number(packet.remaining_slots) <= 0) return null;

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={() => onPress?.(packet)}
        style={({ pressed }) => [styles.luckyBadge, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Şanslı paketi aç"
      >
        <LinearGradient
          colors={["#EF4444", "#B91C1C"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <MaterialCommunityIcons name="gift" size={16} color="#FEF08A" />
        <View style={{ minWidth: 0 }}>
          <Text style={styles.luckyBadgeTitle} numberOfLines={1}>
            {packet.my_claim ? "Alındı" : "Şanslı Paket"}
          </Text>
          <Text style={styles.luckyBadgeSub}>
            {fmtShort(packet.total_amount)} · {leftSec}sn
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
});

const LUCKY_AMOUNTS = [1000, 5000, 25000, 100000];
const LUCKY_SLOTS = [3, 5, 10, 15];

export const LuckyPacketCreateSheet = memo(function LuckyPacketCreateSheet({
  visible,
  roomId,
  coins = 0,
  onCreated,
  onDismiss,
}) {
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState(5000);
  const [slots, setSlots] = useState(5);
  const [note, setNote] = useState("Herkese bol şans!");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (visible) setErr(null);
  }, [visible]);

  const handleSubmit = async () => {
    if (!supabase || !roomId || busy) return;
    if (coins < amount) {
      setErr("Yetersiz kredi bakiyesi");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const { data, error } = await supabase.rpc("create_lucky_packet", {
        p_room_id: roomId,
        p_total_amount: amount,
        p_slots: slots,
        p_message: note.trim() || "Şanslı Paket!",
        p_duration_seconds: 90,
        p_request_id: makeUuid(),
      });
      if (error) throw error;
      playSfx("fanfare");
      onCreated?.(data);
      onDismiss?.();
    } catch (e) {
      setErr(e?.message || "Şanslı paket oluşturulamadı");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onDismiss} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Şanslı Paket Bırak</Text>
              <Text style={styles.subtitle}>
                Odadakiler 90 sn içinde rastgele kredi kapar · Kalan tutar iade edilir
              </Text>
            </View>
            <Pressable onPress={onDismiss} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color="#DCE8FA" />
            </Pressable>
          </View>

          <Text style={styles.fieldLabel}>TOPLAM KREDİ HAVUZU (Bakiye: {fmtShort(coins)})</Text>
          <View style={styles.chipRow}>
            {LUCKY_AMOUNTS.map((v) => (
              <Pressable
                key={v}
                onPress={() => setAmount(v)}
                style={[styles.choiceChip, amount === v && styles.choiceChipGold]}
              >
                <Text style={[styles.choiceChipText, amount === v && styles.choiceChipTextDark]}>
                  {fmtShort(v)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>KİŞİ SAYISI</Text>
          <View style={styles.chipRow}>
            {LUCKY_SLOTS.map((s) => (
              <Pressable
                key={s}
                onPress={() => setSlots(s)}
                style={[styles.choiceChip, slots === s && styles.choiceChipActive]}
              >
                <Text style={[styles.choiceChipText, slots === s && { color: "#FFFFFF" }]}>
                  {s} kişi
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>PAKET MESAJI</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            maxLength={60}
            placeholder="Şanslı Paket!"
            placeholderTextColor="#7087A8"
            style={styles.input}
          />

          {err ? <Text style={styles.errText}>{err}</Text> : null}

          <Pressable
            disabled={busy}
            onPress={handleSubmit}
            style={({ pressed }) => [styles.redCta, pressed && styles.pressed, busy && { opacity: 0.65 }]}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <MaterialCommunityIcons name="gift" size={18} color="#FEF08A" />
                <Text style={styles.redCtaText}>
                  {fmtNum(amount)} Kredilik Paket Bırak
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
});

export const LuckyPacketClaimModal = memo(function LuckyPacketClaimModal({
  packet,
  onClaimed,
  onDismiss,
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setResult(null);
    setErr(null);
  }, [packet?.id]);

  if (!packet) return null;

  const handleOpen = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { data, error } = await supabase.rpc("claim_lucky_packet", {
        p_packet_id: packet.id,
      });
      if (error) throw error;
      setResult(data);
      if (Number(data?.claimed_amount) > 0 && !data?.already_claimed) {
        playSfx("coin");
      }
      onClaimed?.(packet.id, data);
    } catch (e) {
      setErr(e?.message || "Paket açılamadı");
    } finally {
      setBusy(false);
    }
  };

  const claimedAmt = Number(result?.claimed_amount ?? packet.my_claim ?? 0);
  const claimsList = Array.isArray(result?.claims) ? result.claims : [];

  return (
    <Modal transparent visible={Boolean(packet)} animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.centerOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        <LinearGradient
          colors={["#DC2626", "#991B1B", "#450A0A"]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={styles.envelopeCard}
        >
          <Pressable onPress={onDismiss} style={styles.envClose}>
            <Ionicons name="close" size={18} color="#FECACA" />
          </Pressable>

          <View style={styles.envIconOrb}>
            <MaterialCommunityIcons name="gift" size={34} color="#78350F" />
          </View>
          <Text style={styles.envCreator} numberOfLines={1}>
            {packet.creator_name || "Sora"} · Şanslı Paket
          </Text>
          <Text style={styles.envMessage} numberOfLines={2}>
            {packet.message || "Herkese bol şans!"}
          </Text>
          <Text style={styles.envMeta}>
            Havuz: {fmtNum(packet.total_amount)} kredi · Kalan: {result?.remaining_slots ?? packet.remaining_slots}/{packet.total_slots}
          </Text>

          {claimedAmt > 0 ? (
            <View style={styles.envWinBox}>
              <Text style={styles.envWinLabel}>KAZANDIĞIN TUTAR</Text>
              <Text style={styles.envWinAmount}>+{fmtNum(claimedAmt)} kredi</Text>
            </View>
          ) : result?.expired || result?.finished ? (
            <View style={styles.envWinBox}>
              <Text style={styles.envWinLabel}>
                {result.expired ? "Süre doldu" : "Paket tükendi"}
              </Text>
            </View>
          ) : (
            <Pressable
              disabled={busy}
              onPress={handleOpen}
              style={({ pressed }) => [styles.envOpenBtn, pressed && styles.pressed]}
            >
              {busy ? (
                <ActivityIndicator color="#78350F" />
              ) : (
                <Text style={styles.envOpenBtnText}>PAKETİ AÇ</Text>
              )}
            </Pressable>
          )}

          {err ? <Text style={[styles.errText, { textAlign: "center", color: "#FECACA" }]}>{err}</Text> : null}

          {claimsList.length > 0 ? (
            <View style={styles.envClaimsBox}>
              {claimsList.slice(0, 4).map((c) => (
                <View key={c.user_id} style={styles.envClaimRow}>
                  <Text style={styles.envClaimName} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text style={styles.envClaimAmt}>+{fmtNum(c.amount)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </LinearGradient>
      </View>
    </Modal>
  );
});

// ── 3) Oda İçi Canlı Oylama (Anket) ──────────────────────────────────────────
export const RoomPollBanner = memo(function RoomPollBanner({
  poll,
  currentUserId,
  canClose = false,
  onVote,
  onClosePoll,
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (!poll || !Array.isArray(poll.options) || poll.options.length < 2) return null;

  const votesMap = poll.votes || {};
  const myChoice = currentUserId ? votesMap[currentUserId] : null;
  const counts = poll.options.map((_, idx) =>
    Object.values(votesMap).filter((v) => v === idx).length,
  );
  const totalVotes = counts.reduce((a, b) => a + b, 0);

  if (collapsed) {
    return (
      <Pressable onPress={() => setCollapsed(false)} style={styles.pollMiniPill}>
        <Ionicons name="stats-chart" size={12} color="#93C5FD" />
        <Text style={styles.pollMiniText} numberOfLines={1}>
          Oylama ({totalVotes} oy)
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.pollCard}>
      <View style={styles.pollHead}>
        <Ionicons name="stats-chart" size={13} color="#60A5FA" />
        <Text style={styles.pollQuestion} numberOfLines={2}>
          {poll.question}
        </Text>
        <Pressable onPress={() => setCollapsed(true)} hitSlop={8} style={styles.pollHeadBtn}>
          <Ionicons name="chevron-up" size={14} color="#93B2D8" />
        </Pressable>
        {canClose ? (
          <Pressable onPress={onClosePoll} hitSlop={8} style={styles.pollHeadBtn}>
            <Ionicons name="close" size={14} color="#FCA5A5" />
          </Pressable>
        ) : null}
      </View>

      <View style={{ gap: 5, marginTop: 6 }}>
        {poll.options.map((opt, idx) => {
          const pct = totalVotes > 0 ? Math.round((counts[idx] / totalVotes) * 100) : 0;
          const picked = myChoice === idx;
          return (
            <Pressable
              key={idx}
              onPress={() => onVote?.(poll.id, idx)}
              style={[styles.pollOption, picked && styles.pollOptionPicked]}
            >
              <View
                style={[
                  styles.pollOptionBar,
                  { width: `${pct}%` },
                  picked && styles.pollOptionBarPicked,
                ]}
              />
              <Text style={styles.pollOptionText} numberOfLines={1}>
                {opt}
              </Text>
              <Text style={styles.pollOptionPct}>
                {totalVotes > 0 ? `%${pct}` : "0"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.pollFooter}>
        {totalVotes} oy · {poll.creatorName || "Oda"}
      </Text>
    </View>
  );
});

const POLL_PRESETS = [
  { q: "Sonraki şarkı tarzı ne olsun?", opts: ["Türkçe Pop", "Rap / Hip-Hop", "Arabesk / Damar"] },
  { q: "Hangi mini oyunu oynayalım?", opts: ["Şans Zarı", "Doğruluk / Cesaret", "Şans Çarkı"] },
];

export const RoomPollCreateSheet = memo(function RoomPollCreateSheet({
  visible,
  onCreate,
  onDismiss,
}) {
  const insets = useSafeAreaInsets();
  const [question, setQuestion] = useState("");
  const [opt1, setOpt1] = useState("");
  const [opt2, setOpt2] = useState("");
  const [opt3, setOpt3] = useState("");

  const applyPreset = (p) => {
    setQuestion(p.q);
    setOpt1(p.opts[0] || "");
    setOpt2(p.opts[1] || "");
    setOpt3(p.opts[2] || "");
  };

  const handleStart = () => {
    const q = question.trim();
    const options = [opt1, opt2, opt3].map((s) => s.trim()).filter(Boolean);
    if (!q || options.length < 2) return;
    playSfx("chime");
    onCreate?.({ question: q, options });
    setQuestion("");
    setOpt1("");
    setOpt2("");
    setOpt3("");
    onDismiss?.();
  };

  const valid = question.trim().length > 0 && [opt1, opt2, opt3].filter((s) => s.trim()).length >= 2;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onDismiss} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Canlı Oylama Başlat</Text>
              <Text style={styles.subtitle}>Odadaki herkes anında oy verebilir</Text>
            </View>
            <Pressable onPress={onDismiss} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color="#DCE8FA" />
            </Pressable>
          </View>

          <View style={styles.presetRow}>
            {POLL_PRESETS.map((p, i) => (
              <Pressable key={i} onPress={() => applyPreset(p)} style={styles.presetPill}>
                <Text style={styles.presetText} numberOfLines={1}>
                  {p.q}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>SORU</Text>
          <TextInput
            value={question}
            onChangeText={setQuestion}
            maxLength={90}
            placeholder="Örn: Sonraki etkinlik ne olsun?"
            placeholderTextColor="#7087A8"
            style={styles.input}
          />
          <Text style={[styles.fieldLabel, { marginTop: 10 }]}>SEÇENEKLER (EN AZ 2)</Text>
          <TextInput value={opt1} onChangeText={setOpt1} maxLength={40} placeholder="1. Seçenek" placeholderTextColor="#7087A8" style={styles.input} />
          <TextInput value={opt2} onChangeText={setOpt2} maxLength={40} placeholder="2. Seçenek" placeholderTextColor="#7087A8" style={[styles.input, { marginTop: 6 }]} />
          <TextInput value={opt3} onChangeText={setOpt3} maxLength={40} placeholder="3. Seçenek (isteğe bağlı)" placeholderTextColor="#7087A8" style={[styles.input, { marginTop: 6 }]} />

          <Pressable
            disabled={!valid}
            onPress={handleStart}
            style={[styles.blueCta, !valid && { opacity: 0.45 }]}
          >
            <Ionicons name="stats-chart" size={17} color="#FFFFFF" />
            <Text style={styles.blueCtaText}>Oylamayı Başlat</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
});

// ── 4) Geri Sayım / Konuşma Sayacı ───────────────────────────────────────────
export const RoomTimerPill = memo(function RoomTimerPill({ timer, canCancel = false, onCancel }) {
  const [leftSec, setLeftSec] = useState(0);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!timer?.endsAt) return undefined;
    finishedRef.current = false;
    const tick = () => {
      const s = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
      setLeftSec(s);
      if (s === 0 && !finishedRef.current) {
        finishedRef.current = true;
        playSfx("chime");
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timer?.endsAt, timer?.id]);

  if (!timer || !timer.endsAt) return null;
  if (Date.now() > timer.endsAt + 4000) return null;

  const urgent = leftSec > 0 && leftSec <= 10;

  return (
    <Pressable
      onLongPress={canCancel ? onCancel : undefined}
      style={[styles.timerPill, urgent && styles.timerPillUrgent, leftSec === 0 && styles.timerPillDone]}
    >
      <Ionicons
        name={leftSec === 0 ? "alarm" : "hourglass"}
        size={12}
        color={leftSec === 0 ? "#86EFAC" : urgent ? "#FCA5A5" : "#93C5FD"}
      />
      <Text style={styles.timerLabel} numberOfLines={1}>
        {timer.label || "Sayaç"} · {leftSec === 0 ? "Bitti!" : fmtMMSS(leftSec)}
      </Text>
      {canCancel ? (
        <Pressable onPress={onCancel} hitSlop={8}>
          <Ionicons name="close" size={12} color="rgba(255,255,255,0.65)" />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

const TIMER_OPTIONS = [
  { sec: 30, label: "30 sn" },
  { sec: 60, label: "1 dk" },
  { sec: 120, label: "2 dk" },
  { sec: 300, label: "5 dk" },
];

export const RoomTimerCreateSheet = memo(function RoomTimerCreateSheet({
  visible,
  onStart,
  onDismiss,
}) {
  const insets = useSafeAreaInsets();
  const [sec, setSec] = useState(60);
  const [label, setLabel] = useState("Konuşma Süresi");

  const handleGo = () => {
    playSfx("chime");
    onStart?.({ durationSec: sec, label: label.trim() || "Sayaç" });
    onDismiss?.();
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onDismiss} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Geri Sayım Sayacı</Text>
              <Text style={styles.subtitle}>Süre odadaki herkeste senkronize görünür</Text>
            </View>
            <Pressable onPress={onDismiss} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color="#DCE8FA" />
            </Pressable>
          </View>

          <Text style={styles.fieldLabel}>SÜRE SEÇ</Text>
          <View style={styles.chipRow}>
            {TIMER_OPTIONS.map((o) => (
              <Pressable
                key={o.sec}
                onPress={() => setSec(o.sec)}
                style={[styles.choiceChip, sec === o.sec && styles.choiceChipActive]}
              >
                <Text style={[styles.choiceChipText, sec === o.sec && { color: "#FFFFFF" }]}>
                  {o.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>BAŞLIK</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            maxLength={24}
            placeholder="Konuşma Süresi"
            placeholderTextColor="#7087A8"
            style={styles.input}
          />

          <Pressable onPress={handleGo} style={styles.blueCta}>
            <Ionicons name="hourglass" size={17} color="#FFFFFF" />
            <Text style={styles.blueCtaText}>Sayacı Başlat</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
});

// ── 5) Oda İçi Canlı PK Kapışması ────────────────────────────────────────────
export const RoomPkBar = memo(function RoomPkBar({ pk, canEnd = false, onEnd }) {
  const [leftSec, setLeftSec] = useState(0);
  const fanfarePlayedRef = useRef(null);

  useEffect(() => {
    if (!pk?.endsAt) return undefined;
    const tick = () => {
      const s = Math.max(0, Math.ceil((pk.endsAt - Date.now()) / 1000));
      setLeftSec(s);
      if (s === 0 && fanfarePlayedRef.current !== pk.id) {
        fanfarePlayedRef.current = pk.id;
        playSfx("fanfare");
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pk?.endsAt, pk?.id]);

  if (!pk) return null;
  if (Date.now() > pk.endsAt + 12000) return null;

  const leftScore = Math.max(0, Number(pk.leftScore) || 0);
  const rightScore = Math.max(0, Number(pk.rightScore) || 0);
  const total = leftScore + rightScore;
  const leftPct = total === 0 ? 50 : Math.max(12, Math.min(88, Math.round((leftScore / total) * 100)));
  const finished = leftSec === 0;
  const winner =
    !finished
      ? null
      : leftScore > rightScore
        ? `${pk.leftName} kazandı!`
        : rightScore > leftScore
          ? `${pk.rightName} kazandı!`
          : "Berabere!";

  return (
    <View style={styles.pkWrap}>
      <View style={styles.pkNamesRow}>
        <Text style={[styles.pkName, { color: "#93C5FD" }]} numberOfLines={1}>
          {pk.leftName} · {fmtShort(leftScore)}
        </Text>
        <View style={styles.pkCenterPill}>
          <Text style={styles.pkCenterText}>
            {finished ? "PK BİTTİ" : `PK · ${fmtMMSS(leftSec)}`}
          </Text>
        </View>
        <Text style={[styles.pkName, { color: "#FDA4AF", textAlign: "right" }]} numberOfLines={1}>
          {fmtShort(rightScore)} · {pk.rightName}
        </Text>
        {canEnd ? (
          <Pressable onPress={onEnd} hitSlop={8} style={{ marginLeft: 4 }}>
            <Ionicons name="close-circle" size={15} color="rgba(255,255,255,0.55)" />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.pkTrack}>
        <LinearGradient
          colors={["#2563EB", "#38BDF8"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.pkLeftBar, { width: `${leftPct}%` }]}
        />
        <LinearGradient
          colors={["#F43F5E", "#FB7185"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.pkRightBar, { flex: 1 }]}
        />
      </View>

      {winner ? (
        <View style={styles.pkWinnerRow}>
          <MaterialCommunityIcons name="crown" size={13} color="#FDE047" />
          <Text style={styles.pkWinnerText}>{winner}</Text>
        </View>
      ) : null}
    </View>
  );
});

export const RoomPkCreateSheet = memo(function RoomPkCreateSheet({
  visible,
  participants = [],
  onStart,
  onDismiss,
}) {
  const insets = useSafeAreaInsets();
  const [durationSec, setDurationSec] = useState(180);
  const [leftName, setLeftName] = useState("Mavi Takım");
  const [rightName, setRightName] = useState("Kırmızı Takım");
  const [leftId, setLeftId] = useState(null);
  const [rightId, setRightId] = useState(null);

  const uniquePeople = useMemo(() => {
    const seen = new Set();
    return participants.filter((p) => {
      if (!p?.userId || seen.has(p.userId)) return false;
      seen.add(p.userId);
      return true;
    });
  }, [participants]);

  useEffect(() => {
    if (!visible) return;
    if (uniquePeople.length >= 2) {
      setLeftId(uniquePeople[0].userId);
      setLeftName(uniquePeople[0].name || "Mavi Takım");
      setRightId(uniquePeople[1].userId);
      setRightName(uniquePeople[1].name || "Kırmızı Takım");
    } else {
      setLeftId(uniquePeople[0]?.userId || null);
      setLeftName(uniquePeople[0]?.name || "Mavi Takım");
      setRightId(null);
      setRightName("Kırmızı Takım");
    }
  }, [uniquePeople, visible]);

  const handleStart = () => {
    playSfx("fanfare");
    onStart?.({
      leftId,
      rightId,
      leftName: leftName.trim() || "Mavi Takım",
      rightName: rightName.trim() || "Kırmızı Takım",
      durationSec,
    });
    onDismiss?.();
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onDismiss} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Oda PK Kapışması</Text>
              <Text style={styles.subtitle}>
                Süre boyunca gönderilen hediyeler tarafların puanına eklenir
              </Text>
            </View>
            <Pressable onPress={onDismiss} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color="#DCE8FA" />
            </Pressable>
          </View>

          <Text style={styles.fieldLabel}>MAVİ TARAF</Text>
          <TextInput
            value={leftName}
            onChangeText={(t) => {
              setLeftName(t);
              setLeftId(null);
            }}
            maxLength={22}
            style={styles.input}
          />
          <Text style={[styles.fieldLabel, { marginTop: 10 }]}>KIRMIZI TARAF</Text>
          <TextInput
            value={rightName}
            onChangeText={(t) => {
              setRightName(t);
              setRightId(null);
            }}
            maxLength={22}
            style={styles.input}
          />

          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>KAPIŞMA SÜRESİ</Text>
          <View style={styles.chipRow}>
            {[
              { sec: 120, label: "2 dk" },
              { sec: 180, label: "3 dk" },
              { sec: 300, label: "5 dk" },
            ].map((o) => (
              <Pressable
                key={o.sec}
                onPress={() => setDurationSec(o.sec)}
                style={[styles.choiceChip, durationSec === o.sec && styles.choiceChipActive]}
              >
                <Text style={[styles.choiceChipText, durationSec === o.sec && { color: "#FFFFFF" }]}>
                  {o.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable onPress={handleStart} style={styles.pkCta}>
            <MaterialCommunityIcons name="sword-cross" size={18} color="#FFFFFF" />
            <Text style={styles.blueCtaText}>PK Başlat!</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  pressed: { opacity: 0.88, transform: [{ scale: 0.96 }] },
  overlay: { flex: 1, backgroundColor: "rgba(4,10,20,0.68)", justifyContent: "flex-end" },
  centerOverlay: {
    flex: 1,
    backgroundColor: "rgba(4,10,20,0.74)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  backdrop: { flex: 1 },
  sheet: {
    backgroundColor: "#0F1A2E",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: "rgba(124,179,255,0.22)",
    paddingHorizontal: 16,
    paddingTop: 10,
    maxHeight: "82%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(148,176,212,0.35)",
    alignSelf: "center",
    marginBottom: 12,
  },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  title: { color: "#FFFFFF", fontSize: 17.5, fontWeight: "900" },
  subtitle: { color: "#93AECB", fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  centerPad: { paddingVertical: 30, alignItems: "center" },
  scroll: { flexGrow: 0 },
  fieldLabel: {
    color: "#8BA7CC",
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.7,
    marginBottom: 7,
  },
  chipRow: { flexDirection: "row", gap: 8 },
  choiceChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    alignItems: "center",
  },
  choiceChipActive: {
    backgroundColor: "#2563EB",
    borderColor: "rgba(147,197,253,0.7)",
  },
  choiceChipGold: {
    backgroundColor: "#FBBF24",
    borderColor: "#FEF08A",
  },
  choiceChipText: { color: "#CBD5E1", fontSize: 12.5, fontWeight: "800" },
  choiceChipTextDark: { color: "#111827" },
  input: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(148,184,230,0.2)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#FFFFFF",
    fontSize: 13.5,
  },
  errText: { color: "#FCA5A5", fontSize: 12, fontWeight: "700", marginTop: 8 },
  blueCta: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#2563EB",
    borderRadius: 14,
    paddingVertical: 13,
  },
  pkCta: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#E11D48",
    borderRadius: 14,
    paddingVertical: 13,
  },
  blueCtaText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  redCta: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#DC2626",
    borderRadius: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: "rgba(254,240,138,0.45)",
  },
  redCtaText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },

  // Trophy pill
  trophyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(16,28,48,0.78)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.34)",
  },
  trophyText: { color: "#FEF08A", fontSize: 11, fontWeight: "900", fontVariant: ["tabular-nums"] },

  // Leaderboard rows
  emptyBox: { alignItems: "center", paddingVertical: 28, gap: 6 },
  emptyTitle: { color: "#FFFFFF", fontSize: 14.5, fontWeight: "800" },
  emptySub: { color: "#8FA6C4", fontSize: 12, textAlign: "center" },
  lbRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  lbRowMe: {
    borderColor: "rgba(96,165,250,0.55)",
    backgroundColor: "rgba(47,128,237,0.14)",
  },
  lbRank: { width: 24, alignItems: "center" },
  lbRankText: { color: "#94AFCF", fontSize: 13, fontWeight: "900" },
  lbAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  lbInitial: { color: "#FFFFFF", fontWeight: "900", fontSize: 14 },
  lbNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  lbName: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", flexShrink: 1 },
  lbMeta: { color: "#8EA9CB", fontSize: 11, marginTop: 1 },
  lbScorePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(251,191,36,0.14)",
  },
  lbScore: { color: "#FDE047", fontSize: 11.5, fontWeight: "900" },

  // Lucky packet floating badge & modal
  luckyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 13,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(254,240,138,0.65)",
  },
  luckyBadgeTitle: { color: "#FEF08A", fontSize: 10, fontWeight: "900" },
  luckyBadgeSub: { color: "#FFFFFF", fontSize: 9.5, fontWeight: "700", fontVariant: ["tabular-nums"] },
  envelopeCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 24,
    padding: 20,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(254,240,138,0.5)",
  },
  envClose: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  envIconOrb: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#FDE047",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.65)",
  },
  envCreator: { color: "#FEF08A", fontSize: 13, fontWeight: "800" },
  envMessage: { color: "#FFFFFF", fontSize: 16, fontWeight: "900", textAlign: "center", marginTop: 4 },
  envMeta: { color: "#FECACA", fontSize: 11.5, fontWeight: "600", marginTop: 6 },
  envOpenBtn: {
    marginTop: 18,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#FDE047",
  },
  envOpenBtnText: { color: "#78350F", fontSize: 14.5, fontWeight: "900", letterSpacing: 0.6 },
  envWinBox: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.28)",
    alignItems: "center",
  },
  envWinLabel: { color: "#FECACA", fontSize: 10.5, fontWeight: "800", letterSpacing: 0.6 },
  envWinAmount: { color: "#FDE047", fontSize: 22, fontWeight: "900", marginTop: 2 },
  envClaimsBox: {
    marginTop: 14,
    width: "100%",
    backgroundColor: "rgba(0,0,0,0.22)",
    borderRadius: 12,
    padding: 10,
    gap: 5,
  },
  envClaimRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  envClaimName: { color: "#FEF2F2", fontSize: 12, fontWeight: "700", flex: 1, marginRight: 8 },
  envClaimAmt: { color: "#FDE047", fontSize: 12, fontWeight: "900" },

  // Poll banner & create
  pollMiniPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: "rgba(18,32,56,0.9)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.4)",
    alignSelf: "flex-start",
    marginHorizontal: 14,
    marginBottom: 6,
  },
  pollMiniText: { color: "#DBEAFE", fontSize: 11, fontWeight: "800" },
  pollCard: {
    marginHorizontal: 14,
    marginBottom: 6,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(12,23,43,0.92)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.32)",
  },
  pollHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  pollQuestion: { color: "#FFFFFF", fontSize: 12, fontWeight: "800", flex: 1 },
  pollHeadBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  pollOption: {
    position: "relative",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  pollOptionPicked: { borderColor: "rgba(96,165,250,0.75)" },
  pollOptionBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(96,165,250,0.22)",
  },
  pollOptionBarPicked: { backgroundColor: "rgba(59,130,246,0.38)" },
  pollOptionText: { color: "#F1F5F9", fontSize: 11.5, fontWeight: "700", flex: 1, marginRight: 6 },
  pollOptionPct: { color: "#93C5FD", fontSize: 11, fontWeight: "900" },
  pollFooter: { color: "#7E9BC0", fontSize: 10, fontWeight: "600", marginTop: 5 },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  presetPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(59,130,246,0.16)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.3)",
  },
  presetText: { color: "#BFDBFE", fontSize: 11, fontWeight: "700" },

  // Timer pill
  timerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(20,36,64,0.86)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.4)",
  },
  timerPillUrgent: {
    backgroundColor: "rgba(127,29,29,0.88)",
    borderColor: "rgba(252,165,165,0.65)",
  },
  timerPillDone: {
    backgroundColor: "rgba(20,83,45,0.88)",
    borderColor: "rgba(134,239,172,0.6)",
  },
  timerLabel: { color: "#F8FAFC", fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },

  // PK bar
  pkWrap: {
    marginHorizontal: 14,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 13,
    backgroundColor: "rgba(12,21,40,0.9)",
    borderWidth: 1,
    borderColor: "rgba(244,63,94,0.38)",
  },
  pkNamesRow: { flexDirection: "row", alignItems: "center", marginBottom: 5, gap: 6 },
  pkName: { flex: 1, fontSize: 11, fontWeight: "900", fontVariant: ["tabular-nums"] },
  pkCenterPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  pkCenterText: { color: "#FFFFFF", fontSize: 9.5, fontWeight: "900", fontVariant: ["tabular-nums"] },
  pkTrack: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  pkLeftBar: { height: "100%" },
  pkRightBar: { height: "100%" },
  pkWinnerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 5,
  },
  pkWinnerText: { color: "#FDE047", fontSize: 11.5, fontWeight: "900" },
});
