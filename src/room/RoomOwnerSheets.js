import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../theme/colors";
import { DEFAULT_ROOM_ANNOUNCEMENT, ROOM_BAN_DURATIONS } from "./roomApi";

// ── Ortak parçalar ────────────────────────────────────────────────────────
function SheetFrame({ visible, title, subtitle, onDismiss, children, scroll = true }) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onDismiss}>
      <KeyboardAvoidingView
        style={sheetStyles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={sheetStyles.dismiss} onPress={onDismiss} accessibilityLabel="Kapat" />
        <View style={sheetStyles.sheet}>
          <View style={sheetStyles.handle} />
          <View style={sheetStyles.header}>
            <View style={{ flex: 1 }}>
              <Text style={sheetStyles.title}>{title}</Text>
              {subtitle ? <Text style={sheetStyles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable onPress={onDismiss} style={sheetStyles.close} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={18} color={COLORS.text} />
            </Pressable>
          </View>
          {scroll ? (
            <ScrollView
              style={sheetStyles.scroll}
              contentContainerStyle={sheetStyles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Caption({ children, style }) {
  return <Text style={[sheetStyles.caption, style]}>{children}</Text>;
}

function PrimaryButton({ label, icon, onPress, disabled, busy, danger, style }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={[
        sheetStyles.primaryButton,
        danger && sheetStyles.primaryButtonDanger,
        (disabled || busy) && sheetStyles.buttonDisabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : icon ? (
        <Ionicons name={icon} size={17} color="#FFFFFF" />
      ) : null}
      <Text style={sheetStyles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, icon, onPress, disabled, danger, style }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[sheetStyles.secondaryButton, disabled && sheetStyles.buttonDisabled, style]}
    >
      {icon ? <Ionicons name={icon} size={16} color={danger ? COLORS.danger : COLORS.primary} /> : null}
      <Text style={[sheetStyles.secondaryButtonText, danger && { color: COLORS.danger }]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, hint, value, onChangeText, maxLength, multiline, placeholder }) {
  return (
    <View style={sheetStyles.field}>
      <View style={sheetStyles.fieldHead}>
        <Text style={sheetStyles.fieldLabel}>{label}</Text>
        <Text style={sheetStyles.fieldCount}>
          {String(value || "").length}/{maxLength}
        </Text>
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        style={[sheetStyles.input, multiline && sheetStyles.inputMultiline]}
      />
      {hint ? <Text style={sheetStyles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

// 10 basamaklı, kaydırıcı paketi gerektirmeyen ses seviyesi kontrolü.
export const VolumeStepper = memo(function VolumeStepper({ label, value, onChange, disabled }) {
  const steps = 10;
  const level = Math.round((Number(value) || 0) * steps);
  const setLevel = (next) => onChange(Math.min(steps, Math.max(0, next)) / steps);
  return (
    <View style={[sheetStyles.volume, disabled && sheetStyles.buttonDisabled]}>
      {label ? (
        <View style={sheetStyles.volumeHead}>
          <Text style={sheetStyles.volumeLabel}>{label}</Text>
          <Text style={sheetStyles.volumeValue}>%{level * 10}</Text>
        </View>
      ) : null}
      <View style={sheetStyles.volumeRow}>
        <Pressable
          disabled={disabled}
          onPress={() => setLevel(level - 1)}
          style={sheetStyles.volumeButton}
          accessibilityLabel={`${label || "Ses"} azalt`}
        >
          <Ionicons name="volume-low" size={16} color={COLORS.primary} />
        </Pressable>
        <View style={sheetStyles.volumeBars}>
          {Array.from({ length: steps }).map((_, index) => (
            <Pressable
              key={index}
              disabled={disabled}
              onPress={() => setLevel(index + 1)}
              hitSlop={{ top: 10, bottom: 10 }}
              style={[sheetStyles.volumeBar, index < level && sheetStyles.volumeBarOn]}
              accessibilityLabel={`Ses seviyesi %${(index + 1) * 10}`}
            />
          ))}
        </View>
        <Pressable
          disabled={disabled}
          onPress={() => setLevel(level + 1)}
          style={sheetStyles.volumeButton}
          accessibilityLabel={`${label || "Ses"} artır`}
        >
          <Ionicons name="volume-high" size={16} color={COLORS.primary} />
        </Pressable>
      </View>
    </View>
  );
});

// 4 haneli şifre girişi.
export function PinInput({ value, onChange, masked = false, autoFocus = true }) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (!autoFocus) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, [autoFocus]);
  const digits = String(value || "").split("");
  return (
    <Pressable style={sheetStyles.pinRow} onPress={() => inputRef.current?.focus()} accessibilityLabel="4 haneli şifre">
      {Array.from({ length: 4 }).map((_, index) => (
        <View key={index} style={[sheetStyles.pinBox, index === digits.length && sheetStyles.pinBoxActive]}>
          <Text style={sheetStyles.pinDigit}>{digits[index] ? (masked ? "•" : digits[index]) : ""}</Text>
        </View>
      ))}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(text) => onChange(text.replace(/[^0-9]/g, "").slice(0, 4))}
        keyboardType="number-pad"
        maxLength={4}
        style={sheetStyles.pinHiddenInput}
        caretHidden
        autoComplete="off"
        importantForAutofill="no"
      />
    </Pressable>
  );
}

// ── Üç nokta menüsü ───────────────────────────────────────────────────────
function MenuTile({ icon, label, state, badge, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={sheetStyles.tile} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[sheetStyles.tileIcon, active && sheetStyles.tileIconActive]}>
        <Ionicons name={icon} size={20} color={active ? "#FFFFFF" : COLORS.primary} />
        {badge ? (
          <View style={sheetStyles.tileBadge}>
            <Text style={sheetStyles.tileBadgeText}>{badge > 9 ? "9+" : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={sheetStyles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
      {state ? (
        <Text style={sheetStyles.tileState} numberOfLines={1}>
          {state}
        </Text>
      ) : null}
    </Pressable>
  );
}

function MenuSwitchRow({ icon, title, description, value, onToggle }) {
  return (
    <Pressable onPress={onToggle} style={sheetStyles.row} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <View style={sheetStyles.rowIcon}>
        <Ionicons name={icon} size={18} color={COLORS.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={sheetStyles.rowTitle}>{title}</Text>
        <Text style={sheetStyles.rowDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: COLORS.line, true: COLORS.primaryLight }}
        thumbColor={value ? COLORS.primary : "#FFFFFF"}
      />
    </Pressable>
  );
}

export const RoomMenuSheet = memo(function RoomMenuSheet({
  visible,
  menuRole,
  roomLocked,
  chatLocked,
  passwordProtected,
  seatCount,
  coupleSeat,
  requestCount,
  adminCount,
  musicPlaying,
  canBlockHost,
  onAction,
  onDismiss,
}) {
  const isOwner = menuRole === "owner";
  const isStaff = isOwner || menuRole === "admin";
  return (
    <SheetFrame
      visible={visible}
      title={isOwner ? "Oda yönetimi" : isStaff ? "Yönetici paneli" : "Oda bilgileri"}
      onDismiss={onDismiss}
    >
      {isStaff ? (
        <>
          <Caption>{isOwner ? "ODA SAHİBİ KONTROLLERİ" : "YÖNETİCİ KONTROLLERİ"}</Caption>
          <View style={sheetStyles.tileGrid}>
            {isOwner ? (
              <MenuTile icon="settings-outline" label="Oda Ayarları" onPress={() => onAction("settings")} />
            ) : null}
            <MenuTile
              icon="musical-notes-outline"
              label="Müzik"
              state={musicPlaying ? "Çalıyor" : null}
              active={musicPlaying}
              onPress={() => onAction("music")}
            />
            <MenuTile
              icon="hand-left-outline"
              label="Mikrofon İstekleri"
              badge={requestCount}
              onPress={() => onAction("requests")}
            />
            {isOwner ? (
              <MenuTile
                icon="shield-checkmark-outline"
                label="Yöneticiler"
                state={adminCount ? `${adminCount} kişi` : null}
                onPress={() => onAction("admins")}
              />
            ) : null}
            {isOwner ? (
              <MenuTile
                icon={passwordProtected ? "lock-closed" : "lock-open-outline"}
                label="Oda Kilidi"
                state={passwordProtected ? "Şifreli" : "Açık"}
                active={passwordProtected}
                onPress={() => onAction("lock")}
              />
            ) : null}
            {isOwner ? (
              <MenuTile
                icon="grid-outline"
                label="Mikrofon Sayısı"
                state={`${seatCount}${coupleSeat ? " + çift" : ""}`}
                onPress={() => onAction("seats")}
              />
            ) : null}
          </View>
          <MenuSwitchRow
            icon="list-outline"
            title="Mikrofon sırası"
            description={roomLocked ? "Yeni mikrofon istekleri kapalı" : "Dinleyiciler mikrofon isteyebilir"}
            value={!roomLocked}
            onToggle={() => onAction("toggleQueue")}
          />
          <MenuSwitchRow
            icon="chatbubble-outline"
            title="Oda sohbeti"
            description={chatLocked ? "Sadece yöneticiler yazabilir" : "Herkes yazabilir"}
            value={!chatLocked}
            onToggle={() => onAction("toggleChat")}
          />
        </>
      ) : (
        <>
          <Caption>ODA KURALLARI</Caption>
          <View style={sheetStyles.ruleBox}>
            <Ionicons name="heart-outline" size={18} color={COLORS.primary} />
            <Text style={sheetStyles.ruleText}>Saygılı kal, sıranı bekle ve topluluk kurallarına uy.</Text>
          </View>
          <Pressable onPress={() => onAction("music")} style={sheetStyles.row}>
            <View style={sheetStyles.rowIcon}>
              <Ionicons name="musical-notes-outline" size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={sheetStyles.rowTitle}>Müzik sesi</Text>
              <Text style={sheetStyles.rowDescription}>Odadaki müziği kendi cihazında ayarla</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
          </Pressable>
          <Pressable onPress={() => onAction("report")} style={sheetStyles.row}>
            <View style={sheetStyles.rowIcon}>
              <Ionicons name="flag-outline" size={18} color={COLORS.danger} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={sheetStyles.rowTitle}>Odayı bildir</Text>
              <Text style={sheetStyles.rowDescription}>Kural dışı içerik bildir</Text>
            </View>
          </Pressable>
          {canBlockHost ? (
            <Pressable onPress={() => onAction("blockHost")} style={sheetStyles.row}>
              <View style={sheetStyles.rowIcon}>
                <Ionicons name="ban-outline" size={18} color={COLORS.danger} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={sheetStyles.rowTitle}>Oda sahibini engelle</Text>
                <Text style={sheetStyles.rowDescription}>Bu kişinin odalarını görmezsin</Text>
              </View>
            </Pressable>
          ) : null}
        </>
      )}
      <Pressable onPress={() => onAction("invite")} style={[sheetStyles.row, sheetStyles.inviteRow]}>
        <View style={[sheetStyles.rowIcon, sheetStyles.inviteIcon]}>
          <Ionicons name="person-add-outline" size={18} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sheetStyles.rowTitle}>Davet et</Text>
          <Text style={sheetStyles.rowDescription}>Oda bağlantısını paylaş</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
      </Pressable>
    </SheetFrame>
  );
});

// ── Oda ayarları ──────────────────────────────────────────────────────────
const BACKGROUND_STATUS_TEXT = {
  pending: "İncelemede · onaylanınca odada görünecek",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  cancelled: "Yerine yeni görsel gönderildi",
};

export function RoomSettingsEditorSheet({
  visible,
  details,
  backgroundUrl,
  backgroundRequest,
  backgroundUploadsEnabled,
  saving,
  uploadingBackground,
  onSave,
  onPickBackground,
  onClearBackground,
  onOpenMusic,
  onDismiss,
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (!visible) return;
    setTitle(details?.title || "");
    setDescription(details?.description || "");
    setAnnouncement(details?.announcement || DEFAULT_ROOM_ANNOUNCEMENT);
  }, [details?.announcement, details?.description, details?.title, visible]);

  const changed =
    title.trim() !== (details?.title || "") ||
    description.trim() !== (details?.description || "") ||
    (announcement.trim() || DEFAULT_ROOM_ANNOUNCEMENT) !== (details?.announcement || DEFAULT_ROOM_ANNOUNCEMENT);

  const requestStatus = backgroundRequest?.status;
  return (
    <SheetFrame visible={visible} title="Oda Ayarları" subtitle="Değişiklikler odadaki herkese anında yansır." onDismiss={onDismiss}>
      <Field label="ODA ADI" value={title} onChangeText={setTitle} maxLength={36} placeholder="Oda adı" />
      <Field
        label="AÇIKLAMA"
        value={description}
        onChangeText={setDescription}
        maxLength={180}
        multiline
        placeholder="Odanın konusu, kuralları…"
      />
      <Field
        label="ODA DUYURUSU"
        value={announcement}
        onChangeText={setAnnouncement}
        maxLength={200}
        multiline
        placeholder={DEFAULT_ROOM_ANNOUNCEMENT}
        hint="Odaya giren herkese sohbette hoş geldin mesajı olarak gösterilir."
      />
      <PrimaryButton
        label="Kaydet"
        icon="checkmark"
        busy={saving}
        disabled={!changed || !title.trim()}
        onPress={() =>
          onSave({
            title: title.trim(),
            description: description.trim(),
            announcement: announcement.trim() || DEFAULT_ROOM_ANNOUNCEMENT,
          })
        }
      />

      <Caption style={{ marginTop: 24 }}>ODA ARKA PLANI</Caption>
      <View style={sheetStyles.backgroundCard}>
        <View style={sheetStyles.backgroundPreview}>
          {backgroundUrl ? (
            <Image source={{ uri: backgroundUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <Ionicons name="image-outline" size={26} color={COLORS.muted} />
          )}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={sheetStyles.rowTitle}>{backgroundUrl ? "Özel arka plan" : "Varsayılan arka plan"}</Text>
          {requestStatus ? (
            <Text
              style={[
                sheetStyles.rowDescription,
                requestStatus === "pending" && { color: COLORS.primary },
                requestStatus === "rejected" && { color: COLORS.danger },
              ]}
            >
              Son istek: {BACKGROUND_STATUS_TEXT[requestStatus] || requestStatus}
              {requestStatus === "rejected" && backgroundRequest?.review_note ? ` · ${backgroundRequest.review_note}` : ""}
            </Text>
          ) : null}
          {!backgroundUploadsEnabled ? (
            <Text style={[sheetStyles.rowDescription, { color: COLORS.danger }]}>Arka plan değiştirme şu an kapalı.</Text>
          ) : (
            <Text style={sheetStyles.rowDescription}>Yüklediğin görsel incelemeden sonra odada görünür.</Text>
          )}
        </View>
      </View>
      <View style={sheetStyles.buttonRow}>
        <SecondaryButton
          label={uploadingBackground ? "Yükleniyor…" : "Görsel seç"}
          icon="images-outline"
          disabled={!backgroundUploadsEnabled || uploadingBackground}
          onPress={onPickBackground}
          style={{ flex: 1 }}
        />
        {backgroundUrl ? (
          <SecondaryButton label="Kaldır" icon="trash-outline" danger onPress={onClearBackground} style={{ flex: 1 }} />
        ) : null}
      </View>

      <Caption style={{ marginTop: 24 }}>ODA MÜZİĞİ</Caption>
      <Pressable onPress={onOpenMusic} style={sheetStyles.row}>
        <View style={sheetStyles.rowIcon}>
          <Ionicons name="musical-notes-outline" size={18} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sheetStyles.rowTitle}>Müzik ekle ve çal</Text>
          <Text style={sheetStyles.rowDescription}>Dosyalardan müzik seç, ses seviyesini ayarla</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
      </Pressable>
    </SheetFrame>
  );
}

// ── Oda kilidi ────────────────────────────────────────────────────────────
export function RoomLockSheet({ visible, passwordProtected, saving, onSave, onDismiss }) {
  const [pin, setPin] = useState("");
  useEffect(() => {
    if (visible) setPin("");
  }, [visible]);
  return (
    <SheetFrame
      visible={visible}
      title="Oda Kilidi"
      subtitle={
        passwordProtected
          ? "Oda şu an şifreli. Şifreyi değiştirebilir ya da kilidi kaldırabilirsin."
          : "4 haneli bir şifre belirle. Şifreyi bilmeyen kimse odaya giremez."
      }
      onDismiss={onDismiss}
    >
      <View style={sheetStyles.lockHero}>
        <Ionicons name={passwordProtected ? "lock-closed" : "lock-open-outline"} size={30} color={COLORS.primary} />
      </View>
      <PinInput value={pin} onChange={setPin} autoFocus={visible} />
      <PrimaryButton
        label={passwordProtected ? "Şifreyi değiştir" : "Odayı kilitle"}
        icon="lock-closed-outline"
        busy={saving}
        disabled={pin.length !== 4}
        onPress={() => onSave(pin)}
        style={{ marginTop: 18 }}
      />
      {passwordProtected ? (
        <SecondaryButton
          label="Kilidi kaldır"
          icon="lock-open-outline"
          danger
          disabled={saving}
          onPress={() => onSave(null)}
          style={{ marginTop: 10 }}
        />
      ) : null}
      <Text style={sheetStyles.footnote}>Odadaki kişiler etkilenmez; şifre yeni girişlerde sorulur.</Text>
    </SheetFrame>
  );
}

// ── Mikrofon sayısı ───────────────────────────────────────────────────────
function SeatPreview({ count, couple }) {
  const rows = count === 13 ? 3 : 2;
  return (
    <View style={sheetStyles.seatPreview}>
      <View style={sheetStyles.seatPreviewRow}>
        <View style={[sheetStyles.seatDot, sheetStyles.seatDotHost]} />
        {couple ? <View style={[sheetStyles.seatDot, sheetStyles.seatDotCouple]} /> : null}
      </View>
      {Array.from({ length: rows }).map((_, row) => (
        <View key={row} style={sheetStyles.seatPreviewRow}>
          {Array.from({ length: 4 }).map((__, index) => (
            <View key={index} style={sheetStyles.seatDot} />
          ))}
        </View>
      ))}
    </View>
  );
}

export function RoomSeatsSheet({ visible, seatCount, coupleSeat, saving, onSave, onDismiss }) {
  const [count, setCount] = useState(seatCount || 9);
  const [couple, setCouple] = useState(Boolean(coupleSeat));
  useEffect(() => {
    if (!visible) return;
    setCount(seatCount || 9);
    setCouple(Boolean(coupleSeat));
  }, [coupleSeat, seatCount, visible]);
  const changed = count !== (seatCount || 9) || couple !== Boolean(coupleSeat);
  return (
    <SheetFrame
      visible={visible}
      title="Mikrofon Sayısı"
      subtitle="Oda sahibi her zaman en üstte. Koltuklar 4'erli sıralar halinde artar."
      onDismiss={onDismiss}
    >
      <View style={sheetStyles.seatOptions}>
        {[9, 13].map((option) => (
          <Pressable
            key={option}
            onPress={() => setCount(option)}
            style={[sheetStyles.seatOption, count === option && sheetStyles.seatOptionActive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: count === option }}
          >
            <SeatPreview count={option} couple={couple} />
            <Text style={[sheetStyles.seatOptionTitle, count === option && { color: COLORS.primary }]}>
              {option} mikrofon
            </Text>
            <Text style={sheetStyles.rowDescription}>1 + {option - 1} koltuk</Text>
          </Pressable>
        ))}
      </View>
      <MenuSwitchRow
        icon="heart-outline"
        title="Çift koltuğu"
        description="Oda sahibinin hemen yanına bir mikrofon daha açar"
        value={couple}
        onToggle={() => setCouple((value) => !value)}
      />
      <PrimaryButton
        label="Uygula"
        icon="checkmark"
        busy={saving}
        disabled={!changed}
        onPress={() => onSave({ seatCount: count, coupleSeat: couple })}
        style={{ marginTop: 16 }}
      />
      <Text style={sheetStyles.footnote}>Kapanan koltuklarda oturanlar mikrofondan indirilir.</Text>
    </SheetFrame>
  );
}

// ── Kişi satırı ───────────────────────────────────────────────────────────
function PersonRow({ person, caption, children }) {
  return (
    <View style={sheetStyles.personRow}>
      <View style={[sheetStyles.personAvatar, { backgroundColor: person.color || COLORS.primaryLight }]}>
        <Text style={sheetStyles.personInitial}>{person.name?.charAt(0)?.toUpperCase() || "?"}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={sheetStyles.rowTitle} numberOfLines={1}>
          {person.name}
        </Text>
        {caption ? (
          <Text style={sheetStyles.rowDescription} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function SmallButton({ label, onPress, danger, primary, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        sheetStyles.smallButton,
        primary && sheetStyles.smallButtonPrimary,
        danger && sheetStyles.smallButtonDanger,
        disabled && sheetStyles.buttonDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text
        style={[
          sheetStyles.smallButtonText,
          primary && { color: "#FFFFFF" },
          danger && { color: COLORS.danger },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ── Yöneticiler ───────────────────────────────────────────────────────────
export function RoomAdminsSheet({ visible, participants, busyUserId, onToggleAdmin, onDismiss }) {
  const admins = participants.filter((person) => person.role === "moderator");
  const others = participants.filter((person) => person.role !== "moderator");
  return (
    <SheetFrame
      visible={visible}
      title="Yöneticiler"
      subtitle="Yöneticiler mikrofon isteklerini onaylar, mikrofondan indirir (10 dk) ve süreli ban atabilir."
      onDismiss={onDismiss}
    >
      <Caption>YÖNETİCİLER ({admins.length})</Caption>
      {admins.length ? (
        admins.map((person) => (
          <PersonRow key={person.userId} person={person} caption="Yönetici">
            <SmallButton
              label="Yetkiyi al"
              danger
              disabled={busyUserId === person.userId}
              onPress={() => onToggleAdmin(person)}
            />
          </PersonRow>
        ))
      ) : (
        <Text style={sheetStyles.empty}>Henüz yönetici yok.</Text>
      )}
      <Caption style={{ marginTop: 20 }}>ODADAKİLER</Caption>
      {others.length ? (
        others.map((person) => (
          <PersonRow key={person.userId} person={person} caption={person.seat !== null && person.seat !== undefined ? "Mikrofonda" : "Dinleyici"}>
            <SmallButton
              label="Yönetici yap"
              primary
              disabled={busyUserId === person.userId}
              onPress={() => onToggleAdmin(person)}
            />
          </PersonRow>
        ))
      ) : (
        <Text style={sheetStyles.empty}>Odada yönetici yapılabilecek kimse yok.</Text>
      )}
    </SheetFrame>
  );
}

// ── Mikrofon istekleri ────────────────────────────────────────────────────
export function MicRequestsSheet({ visible, requests, busyUserId, onApprove, onReject, onDismiss }) {
  return (
    <SheetFrame
      visible={visible}
      title="Mikrofon İstekleri"
      subtitle="Onaylanan kişi ilk boş koltuğa oturur."
      onDismiss={onDismiss}
    >
      {requests.length ? (
        requests.map((person) => (
          <PersonRow
            key={person.userId}
            person={person}
            caption={person.handRaisedAt ? `İstek: ${new Date(person.handRaisedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}` : null}
          >
            <SmallButton label="Reddet" danger disabled={busyUserId === person.userId} onPress={() => onReject(person)} />
            <SmallButton label="Onayla" primary disabled={busyUserId === person.userId} onPress={() => onApprove(person)} />
          </PersonRow>
        ))
      ) : (
        <View style={sheetStyles.emptyBox}>
          <Ionicons name="hand-left-outline" size={26} color={COLORS.muted} />
          <Text style={sheetStyles.empty}>Bekleyen mikrofon isteği yok.</Text>
        </View>
      )}
    </SheetFrame>
  );
}

// ── Müzik ─────────────────────────────────────────────────────────────────
const formatTime = (ms) => {
  const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
};

export function RoomMusicSheet({
  visible,
  canControl,
  musicState,
  music,
  tracks,
  loadingTracks,
  busy,
  onAddTrack,
  onPlayTrack,
  onTogglePlay,
  onStop,
  onRoomVolume,
  onDeleteTrack,
  onDismiss,
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!visible || !musicState?.playing) return undefined;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [musicState?.playing, visible]);
  const position = musicState ? music.currentPositionMs() : 0;
  const durationMs = (music.duration || 0) * 1000;
  return (
    <SheetFrame
      visible={visible}
      title="Müzik"
      subtitle={canControl ? "Odadaki herkes aynı müziği duyar." : "Odadaki müziği kendi cihazında ayarlayabilirsin."}
      onDismiss={onDismiss}
    >
      <View style={sheetStyles.nowPlaying}>
        <View style={sheetStyles.nowPlayingIcon}>
          <Ionicons name={musicState?.playing ? "musical-notes" : "musical-note-outline"} size={22} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={sheetStyles.rowTitle} numberOfLines={1}>
            {musicState?.title || "Müzik çalmıyor"}
          </Text>
          <Text style={sheetStyles.rowDescription}>
            {musicState
              ? music.status === "loading"
                ? "Yükleniyor…"
                : music.status === "error"
                  ? "Çalınamadı"
                  : `${musicState.playing ? "Çalıyor" : "Duraklatıldı"} · ${formatTime(position)}${durationMs ? ` / ${formatTime(durationMs)}` : ""}`
              : canControl
                ? "Aşağıdan bir müzik seç ya da dosyalardan ekle."
                : "Oda sahibi müzik açtığında burada görünür."}
          </Text>
        </View>
        {canControl && musicState ? (
          <View style={sheetStyles.nowPlayingActions}>
            <Pressable onPress={onTogglePlay} disabled={busy} style={sheetStyles.roundButton} accessibilityLabel={musicState.playing ? "Duraklat" : "Çal"}>
              <Ionicons name={musicState.playing ? "pause" : "play"} size={18} color={COLORS.primary} />
            </Pressable>
            <Pressable onPress={onStop} disabled={busy} style={sheetStyles.roundButton} accessibilityLabel="Müziği kapat">
              <Ionicons name="stop" size={16} color={COLORS.danger} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {canControl ? (
        <VolumeStepper
          label="Oda müzik sesi (herkes için)"
          value={musicState?.volume ?? 0.7}
          onChange={onRoomVolume}
          disabled={!musicState || busy}
        />
      ) : null}
      <VolumeStepper label="Benim cihazımda" value={music.localVolume} onChange={music.setLocalVolume} />

      {canControl ? (
        <>
          <View style={sheetStyles.trackHead}>
            <Caption style={{ marginBottom: 0 }}>ODA MÜZİK LİSTESİ</Caption>
            {loadingTracks ? <ActivityIndicator size="small" color={COLORS.primary} /> : null}
          </View>
          <PrimaryButton
            label={busy ? "Yükleniyor…" : "Dosyalardan müzik ekle"}
            icon="add"
            busy={busy}
            onPress={onAddTrack}
          />
          {tracks.length ? (
            tracks.map((track) => {
              const active = musicState?.path === track.path;
              return (
                <View key={track.path} style={sheetStyles.trackRow}>
                  <Pressable
                    onPress={() => onPlayTrack(track)}
                    disabled={busy}
                    style={sheetStyles.trackMain}
                    accessibilityLabel={`${track.title} çal`}
                  >
                    <Ionicons
                      name={active && musicState?.playing ? "volume-high" : "play-circle-outline"}
                      size={22}
                      color={COLORS.primary}
                    />
                    <Text style={[sheetStyles.trackTitle, active && { color: COLORS.primary }]} numberOfLines={1}>
                      {track.title}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onDeleteTrack(track)}
                    disabled={busy}
                    style={sheetStyles.trackDelete}
                    accessibilityLabel={`${track.title} sil`}
                  >
                    <Ionicons name="trash-outline" size={16} color={COLORS.muted} />
                  </Pressable>
                </View>
              );
            })
          ) : !loadingTracks ? (
            <Text style={[sheetStyles.empty, { marginTop: 12 }]}>Listede müzik yok. MP3, M4A, WAV veya OGG ekleyebilirsin (en fazla 25 MB).</Text>
          ) : null}
        </>
      ) : null}
    </SheetFrame>
  );
}

// ── Ban süresi ────────────────────────────────────────────────────────────
export function BanDurationSheet({ participant, busy, onSelect, onDismiss }) {
  return (
    <SheetFrame
      visible={Boolean(participant)}
      title="Odadan banla"
      subtitle={participant ? `${participant.name} odadan çıkarılacak. Süreyi seç.` : null}
      onDismiss={onDismiss}
    >
      {ROOM_BAN_DURATIONS.map((option) => (
        <Pressable
          key={option.label}
          disabled={busy}
          onPress={() => onSelect(option.minutes)}
          style={[sheetStyles.row, busy && sheetStyles.buttonDisabled]}
          accessibilityRole="button"
        >
          <View style={sheetStyles.rowIcon}>
            <Ionicons name={option.minutes ? "time-outline" : "infinite-outline"} size={18} color={COLORS.danger} />
          </View>
          <Text style={[sheetStyles.rowTitle, { flex: 1 }]}>{option.label}</Text>
          <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
        </Pressable>
      ))}
    </SheetFrame>
  );
}

// ── Şifreli odaya giriş ───────────────────────────────────────────────────
export function RoomPasswordPrompt({ room, error, busy, onSubmit, onDismiss }) {
  const [pin, setPin] = useState("");
  useEffect(() => {
    setPin("");
  }, [room?.id]);
  useEffect(() => {
    if (error) setPin("");
  }, [error]);
  return (
    <SheetFrame
      visible={Boolean(room)}
      title="Şifreli oda"
      subtitle={room ? `${room.title} odasına girmek için 4 haneli şifreyi yaz.` : null}
      onDismiss={onDismiss}
    >
      <View style={sheetStyles.lockHero}>
        <Ionicons name="lock-closed" size={30} color={COLORS.primary} />
      </View>
      <PinInput value={pin} onChange={setPin} masked autoFocus={Boolean(room)} />
      {error ? <Text style={sheetStyles.errorText}>{error}</Text> : null}
      <PrimaryButton
        label="Odaya gir"
        icon="enter-outline"
        busy={busy}
        disabled={pin.length !== 4}
        onPress={() => onSubmit(pin)}
        style={{ marginTop: 18 }}
      />
    </SheetFrame>
  );
}

export const useRequestsFromMembers = (members, participants) =>
  useMemo(() => {
    const connectedIds = new Set(participants.map((participant) => participant.userId));
    return members
      .filter((member) => member.handRaisedAt && connectedIds.has(member.userId))
      .map((member) => {
        const live = participants.find((participant) => participant.userId === member.userId);
        return { ...member, seat: live?.seat ?? null };
      })
      .filter((member) => member.seat === null || member.seat === undefined)
      .sort((first, second) => Date.parse(first.handRaisedAt) - Date.parse(second.handRaisedAt));
  }, [members, participants]);

const sheetStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(5,6,11,0.62)", justifyContent: "flex-end" },
  dismiss: { flex: 1 },
  sheet: {
    maxHeight: "88%",
    backgroundColor: COLORS.surface,
    paddingTop: 22,
    paddingBottom: Platform.OS === "ios" ? 30 : 40,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 4,
    backgroundColor: COLORS.line,
    position: "absolute",
    alignSelf: "center",
    top: 9,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 20, marginBottom: 14 },
  title: { color: COLORS.text, fontSize: 21, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: COLORS.mutedDark, fontSize: 12, lineHeight: 17, marginTop: 4 },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 8 },
  caption: { color: COLORS.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginBottom: 10 },
  tileGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4, marginBottom: 8 },
  tile: { width: "33.333%", alignItems: "center", paddingHorizontal: 4, paddingVertical: 8, gap: 5 },
  tileIcon: {
    width: 50,
    height: 50,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceRaised,
  },
  tileIconActive: { backgroundColor: COLORS.primary },
  tileBadge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.danger,
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  tileBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  tileLabel: { color: COLORS.text, fontSize: 11, fontWeight: "800", textAlign: "center" },
  tileState: { color: COLORS.primary, fontSize: 9, fontWeight: "800", marginTop: -2 },
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lineSoft,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceRaised,
  },
  rowTitle: { color: COLORS.text, fontSize: 13, fontWeight: "800" },
  rowDescription: { color: COLORS.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  inviteRow: { marginTop: 10, borderBottomWidth: 0 },
  inviteIcon: { backgroundColor: COLORS.primary },
  ruleBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceRaised,
    marginBottom: 6,
  },
  ruleText: { flex: 1, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  field: { marginBottom: 14 },
  fieldHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  fieldLabel: { color: COLORS.textSecondary, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  fieldCount: { color: COLORS.muted, fontSize: 10, fontWeight: "700" },
  fieldHint: { color: COLORS.muted, fontSize: 11, lineHeight: 15, marginTop: 6 },
  input: {
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
    color: COLORS.text,
    fontSize: 14,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },
  primaryButton: {
    minHeight: 48,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
  },
  primaryButtonDanger: { backgroundColor: COLORS.danger },
  primaryButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: COLORS.surfaceRaised,
    paddingHorizontal: 14,
  },
  secondaryButtonText: { color: COLORS.primary, fontSize: 13, fontWeight: "800" },
  buttonDisabled: { opacity: 0.45 },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  backgroundCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  backgroundPreview: {
    width: 64,
    height: 96,
    borderRadius: 14,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  lockHero: {
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primarySoft,
    marginBottom: 18,
  },
  pinRow: { flexDirection: "row", justifyContent: "center", gap: 12 },
  pinBox: {
    width: 54,
    height: 62,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1.5,
    borderColor: COLORS.line,
  },
  pinBoxActive: { borderColor: COLORS.primary },
  pinDigit: { color: COLORS.text, fontSize: 26, fontWeight: "900" },
  pinHiddenInput: { position: "absolute", opacity: 0, width: 1, height: 1 },
  footnote: { color: COLORS.muted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 14 },
  errorText: { color: COLORS.danger, fontSize: 12, fontWeight: "700", textAlign: "center", marginTop: 12 },
  seatOptions: { flexDirection: "row", gap: 12, marginBottom: 8 },
  seatOption: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingVertical: 14,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: COLORS.line,
    backgroundColor: COLORS.surface,
  },
  seatOptionActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primarySoft },
  seatOptionTitle: { color: COLORS.text, fontSize: 14, fontWeight: "900", marginTop: 6 },
  seatPreview: { gap: 5, alignItems: "center" },
  seatPreviewRow: { flexDirection: "row", gap: 5, justifyContent: "center" },
  seatDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: "rgba(47,128,237,0.35)" },
  seatDotHost: { width: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.primary },
  seatDotCouple: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#E46FA0" },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lineSoft,
  },
  personAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  personInitial: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  smallButton: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceRaised,
  },
  smallButtonPrimary: { backgroundColor: COLORS.primary },
  smallButtonDanger: { backgroundColor: "rgba(217,79,92,0.1)" },
  smallButtonText: { color: COLORS.text, fontSize: 12, fontWeight: "800" },
  empty: { color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  emptyBox: { alignItems: "center", gap: 8, paddingVertical: 26 },
  nowPlaying: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceRaised,
    marginBottom: 14,
  },
  nowPlayingIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },
  nowPlayingActions: { flexDirection: "row", gap: 8 },
  roundButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
  },
  volume: { marginBottom: 14 },
  volumeHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  volumeLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "800" },
  volumeValue: { color: COLORS.primary, fontSize: 12, fontWeight: "900" },
  volumeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  volumeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceRaised,
  },
  volumeBars: { flex: 1, flexDirection: "row", gap: 4, alignItems: "center" },
  volumeBar: { flex: 1, height: 12, borderRadius: 4, backgroundColor: COLORS.line },
  volumeBarOn: { backgroundColor: COLORS.primary },
  trackHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, marginBottom: 10 },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lineSoft,
  },
  trackMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  trackTitle: { flex: 1, color: COLORS.text, fontSize: 13, fontWeight: "700" },
  trackDelete: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
