import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { DEFAULT_GIFT_CATALOG, SoraGiftArtwork } from "../../src/ui/SoraGiftArtwork";
import { SoraGiftEffect } from "../../src/ui/SoraGiftEffect";
import { useReducedMotion } from "../../src/ui/Motion";

const query = typeof location === "undefined" ? null : new URLSearchParams(location.search);
const initialIndex = Math.max(0, DEFAULT_GIFT_CATALOG.findIndex((item) => item.id === query?.get("gift")));
const sceneOnly = query?.get("scene") === "1";
const format = (value) => new Intl.NumberFormat("tr-TR").format(value);

function Button({ label, onPress, active = false }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.button, active && styles.activeButton, pressed && { opacity: 0.7 }]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

export default function GiftPreview() {
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [event, setEvent] = useState(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const eventSerial = useRef(0);
  const selectedIndexRef = useRef(initialIndex);
  const selected = DEFAULT_GIFT_CATALOG[selectedIndex];
  const play = useCallback((index) => {
    const next = (index + DEFAULT_GIFT_CATALOG.length) % DEFAULT_GIFT_CATALOG.length;
    const target = DEFAULT_GIFT_CATALOG[next];
    selectedIndexRef.current = next;
    setSelectedIndex(next);
    setEvent({ ...target, eventId: `preview-${++eventSerial.current}`, stamp: Date.now(), recipientName: "Önizleme", quantity: 1 });
  }, []);
  useEffect(() => {
    if (!autoPlay) return undefined;
    const timer = setInterval(() => play(selectedIndexRef.current + 1), 5000);
    return () => clearInterval(timer);
  }, [autoPlay, play]);
  useEffect(() => {
    if (query?.get("play") === "1") {
      const timer = setTimeout(() => play(initialIndex), 600);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [play]);

  const room = <LinearGradient colors={["#13284B", "#0C1424", "#090F1B"]} style={[styles.room, sceneOnly && styles.fullRoom]}>
    <View style={styles.roomHeader}><View><Text style={styles.roomTitle}>Sora hediye stüdyosu</Text><Text style={styles.roomHint}>Görsel ve animasyon önizlemesi</Text></View><Text style={styles.menu}>•••</Text></View>
    <View style={styles.stage}>
      <View style={styles.host}><Text style={styles.initial}>S</Text></View><Text style={styles.hostLabel}>Oda sahibi</Text>
      {[0, 1].map((row) => <View key={row} style={styles.seatRow}>{[0, 1, 2, 3].map((column) => <View key={column} style={styles.seatGroup}><View style={styles.seat}><View style={styles.micCapsule} /><View style={styles.micStand} /></View><Text style={styles.seatLabel}>{row * 4 + column + 1}</Text></View>)}</View>)}
    </View>
    <View style={styles.chat}><Text style={styles.chatLine}><Text style={{ color: "#88B9FF" }}>Sora  </Text>Hediyenin sahnesini görmek için Oynat’a dokun.</Text><Text style={styles.chatLine}>Bu araç hiçbir hesaba bağlanmaz; coin harcanmaz.</Text></View>
    <View style={styles.selected}><SoraGiftArtwork giftId={selected.id} giftName={selected.name} size={72} /><View style={{ flex: 1 }}><Text style={styles.selectedTitle}>{selected.name}</Text><Text style={styles.roomHint}>{selectedIndex + 1} / 34 · katalog görseli</Text></View></View>
    <View style={styles.controls}><Button label="Önceki" onPress={() => play(selectedIndex - 1)} /><Button label="Oynat" active onPress={() => play(selectedIndex)} /><Button label="Sonraki" onPress={() => play(selectedIndex + 1)} /></View>
    <View style={styles.autoRow}><Button label={autoPlay ? "Otomatik durdur" : "Tümünü sırayla oynat"} active={autoPlay} onPress={() => { if (!autoPlay) play(selectedIndex); setAutoPlay((value) => !value); }} /></View>
    <Text style={styles.motionNote}>Hareket azaltma: {reducedMotion ? "açık — kısa sabit gösterim" : "kapalı — tam animasyon"}</Text>
    <SoraGiftEffect gift={event} />
  </LinearGradient>;
  if (sceneOnly) return room;
  return <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
    <Text style={styles.pageEyebrow}>SORA VOICE / TASARIM KONTROLÜ</Text><Text style={styles.pageTitle}>34 özgün hediye</Text><Text style={styles.pageSubtitle}>Uygulamanın gerçek React Native çizim ve animasyon bileşenleri. Kartı seçerek yeniden oynat.</Text>
    <View style={[styles.workspace, width < 900 && { flexDirection: "column" }]}>{room}<View style={styles.gallery}>{DEFAULT_GIFT_CATALOG.map((gift, index) => <Pressable key={gift.id} accessibilityRole="button" accessibilityLabel={`${gift.name} efektini oynat`} onPress={() => play(index)} style={({ pressed }) => [styles.card, selected.id === gift.id && styles.cardSelected, pressed && { opacity: 0.75 }]}><SoraGiftArtwork giftId={gift.id} giftName={gift.name} size={104} /><Text style={styles.cardName}>{gift.name}</Text><Text style={styles.cardPrice}>{format(gift.cost)} coin</Text></Pressable>)}</View></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#EAF1FC" }, pageContent: { padding: 24 }, pageEyebrow: { color: "#3764A5", fontSize: 11, fontWeight: "800", letterSpacing: 2 }, pageTitle: { color: "#13284B", fontSize: 36, fontWeight: "900", marginTop: 10 }, pageSubtitle: { color: "#536582", fontSize: 14, lineHeight: 22, marginVertical: 16 }, workspace: { flexDirection: "row", alignItems: "flex-start", gap: 24 },
  room: { width: 390, height: 844, overflow: "hidden", borderRadius: 24, paddingTop: 26 }, fullRoom: { flex: 1, width: "100%", height: "100%", borderRadius: 0 }, roomHeader: { paddingHorizontal: 22, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, roomTitle: { color: "#F2F7FF", fontSize: 18, fontWeight: "800" }, roomHint: { color: "#8EA5C6", fontSize: 11, marginTop: 5 }, menu: { color: "#D4E5FF", fontSize: 20 },
  stage: { alignItems: "center", marginTop: 26, paddingHorizontal: 18 }, host: { width: 74, height: 74, borderRadius: 37, borderWidth: 2, borderColor: "#9AC8FF", backgroundColor: "#245389", alignItems: "center", justifyContent: "center" }, initial: { color: "#FFFFFF", fontSize: 25, fontWeight: "800" }, hostLabel: { color: "#B4C8E2", fontSize: 10, marginTop: 8, marginBottom: 15 }, seatRow: { flexDirection: "row", justifyContent: "space-around", width: "100%", marginVertical: 9 }, seatGroup: { alignItems: "center", gap: 6 }, seat: { width: 54, height: 54, borderRadius: 27, borderWidth: 1, borderColor: "#345174", backgroundColor: "#1D304D", alignItems: "center", justifyContent: "center" }, micCapsule: { width: 10, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: "#AFC7E6" }, micStand: { width: 16, height: 10, borderBottomWidth: 1.5, borderLeftWidth: 1.5, borderRightWidth: 1.5, borderColor: "#AFC7E6", borderBottomLeftRadius: 8, borderBottomRightRadius: 8, position: "absolute", top: 26 }, seatLabel: { color: "#8EA5C6", fontSize: 10 },
  chat: { marginTop: 30, paddingHorizontal: 22, flex: 1 }, chatLine: { color: "#B2C1D8", fontSize: 12, lineHeight: 20, marginBottom: 12 }, selected: { paddingHorizontal: 22, flexDirection: "row", alignItems: "center", gap: 14, paddingBottom: 12 }, selectedTitle: { color: "#FFFFFF", fontWeight: "800", fontSize: 19 }, controls: { flexDirection: "row", justifyContent: "center", gap: 8, paddingHorizontal: 16 }, button: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "#213653", borderWidth: 1, borderColor: "#3C5C83" }, activeButton: { backgroundColor: "#246EDF", borderColor: "#6CA8FF" }, buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 12 }, autoRow: { alignItems: "center", marginTop: 10 }, motionNote: { color: "#7E96B8", textAlign: "center", fontSize: 10, paddingVertical: 14 },
  gallery: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 12 }, card: { width: 142, minHeight: 162, backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 2, borderColor: "transparent", alignItems: "center", padding: 10 }, cardSelected: { borderColor: "#2F80ED", backgroundColor: "#F5F9FF" }, cardName: { color: "#17375E", fontSize: 11, fontWeight: "800", marginTop: 6, textAlign: "center" }, cardPrice: { color: "#547397", fontSize: 10, marginTop: 4 },
});
