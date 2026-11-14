import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export function EmailVerificationSheet({ visible, email, onContinue }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onContinue}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.icon}>
            <Ionicons name="checkmark" size={32} color="#063A2D" />
          </View>
          <Text style={styles.kicker}>SORA HESABI</Text>
          <Text style={styles.title}>Hesabın doğrulandı.</Text>
          <Text style={styles.subtitle}>
            {email ? `${email} adresi artık doğrulanmış durumda. ` : "E-posta adresin artık doğrulanmış durumda. "}
            Sora odalarına katılmaya hazırsın.
          </Text>
          <Pressable onPress={onContinue} style={styles.button}>
            <Text style={styles.buttonText}>Devam et</Text>
            <Ionicons name="arrow-forward" size={19} color="#063A2D" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(5, 18, 19, 0.62)",
  },
  card: {
    width: "100%",
    maxWidth: 380,
    alignItems: "center",
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 22,
    backgroundColor: "#FFFFFF",
    shadowColor: "#001B18",
    shadowOpacity: 0.2,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  icon: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    borderRadius: 36,
    backgroundColor: "#01D9A8",
  },
  kicker: {
    color: "#01A884",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  title: {
    color: "#11161C",
    fontSize: 25,
    fontWeight: "900",
    letterSpacing: -0.8,
    textAlign: "center",
  },
  subtitle: {
    color: "#566171",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
    textAlign: "center",
  },
  button: {
    width: "100%",
    height: 52,
    alignItems: "center",
    justifyContent: "space-between",
    flexDirection: "row",
    marginTop: 24,
    paddingHorizontal: 17,
    borderRadius: 15,
    backgroundColor: "#01D9A8",
  },
  buttonText: {
    color: "#063A2D",
    fontSize: 14,
    fontWeight: "900",
  },
});
