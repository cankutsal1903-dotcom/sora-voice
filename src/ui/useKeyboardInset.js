import { useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, KeyboardAvoidingView, Platform, View } from "react-native";

/**
 * Ekran klavyesinin açık olup olmadığını ve yüksekliğini takip eder.
 */
export function useKeyboardInset() {
  const [state, setState] = useState({
    visible: false,
    height: 0,
    screenY: 0,
  });

  useEffect(() => {
    if (Platform.OS === "web") return undefined;

    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const handleShow = (event) => {
      const height = Math.max(0, Math.round(event?.endCoordinates?.height || 0));
      const winH = Dimensions.get("window").height;
      const rawScreenY = Number(event?.endCoordinates?.screenY || 0);
      const screenY = rawScreenY > 0 ? rawScreenY : Math.max(0, winH - height);
      setState({
        visible: height > 0,
        height,
        screenY,
      });
    };

    const handleHide = () => {
      setState({ visible: false, height: 0, screenY: 0 });
    };

    const showSub = Keyboard.addListener(showEvent, handleShow);
    const hideSub = Keyboard.addListener(hideEvent, handleHide);
    const extraShowSub =
      Platform.OS === "ios" ? Keyboard.addListener("keyboardDidShow", handleShow) : null;
    const extraHideSub =
      Platform.OS === "ios" ? Keyboard.addListener("keyboardDidHide", handleHide) : null;

    return () => {
      showSub.remove();
      hideSub.remove();
      extraShowSub?.remove();
      extraHideSub?.remove();
    };
  }, []);

  return state;
}

/**
 * Hem ana ekranlarda hem de <Modal transparent> ve tam ekran katmanlarda (Oda sahnesi vb.)
 * Android adjustResize / edge-to-edge farklarını gerçek pencere koordinatlarıyla ölçerek
 * klavyenin hiçbir giriş alanını kapatmamasını ve çift boşluk oluşmamasını sağlar.
 */
export function KeyboardSafeView({
  style,
  children,
  iosOffset = 0,
  extraOffset = 0,
  pointerEvents,
}) {
  const keyboard = useKeyboardInset();
  const viewRef = useRef(null);
  const restingHeightRef = useRef(0);
  const [androidBottomPad, setAndroidBottomPad] = useState(0);

  const measureOverlap = useCallback(() => {
    if (Platform.OS !== "android") return;
    if (!keyboard.visible || keyboard.height <= 0) {
      setAndroidBottomPad(0);
      return;
    }
    const node = viewRef.current;
    if (!node || typeof node.measureInWindow !== "function") {
      setAndroidBottomPad(keyboard.height + extraOffset);
      return;
    }
    node.measureInWindow((_x, y, width, height) => {
      if (width <= 0 || height <= 0) {
        setAndroidBottomPad(keyboard.height + extraOffset);
        return;
      }
      // Mevcut alt kenar, uygulanmış padding'i de içerir; ham kapsayıcı alt kenarı ile klavye üst kenarını kıyasla
      const rawBottom = y + height;
      if (keyboard.screenY > 0) {
        const overlap = Math.max(0, Math.round(rawBottom - keyboard.screenY));
        setAndroidBottomPad(overlap > 4 ? overlap + extraOffset : 0);
        return;
      }
      const shrunk = restingHeightRef.current > 0 ? Math.max(0, restingHeightRef.current - height) : 0;
      const remaining = Math.max(0, Math.round(keyboard.height - shrunk));
      setAndroidBottomPad(remaining > 4 ? remaining + extraOffset : 0);
    });
  }, [extraOffset, keyboard.height, keyboard.screenY, keyboard.visible]);

  useEffect(() => {
    if (Platform.OS !== "android") return undefined;
    measureOverlap();
    const timer = setTimeout(measureOverlap, 70);
    return () => clearTimeout(timer);
  }, [measureOverlap]);

  const handleLayout = useCallback(
    (event) => {
      const h = event?.nativeEvent?.layout?.height || 0;
      if (!keyboard.visible && h > 0) {
        restingHeightRef.current = h;
      }
      if (Platform.OS === "android" && keyboard.visible) {
        measureOverlap();
      }
    },
    [keyboard.visible, measureOverlap],
  );

  if (Platform.OS === "ios") {
    return (
      <KeyboardAvoidingView
        style={[{ flex: 1 }, style]}
        behavior="padding"
        keyboardVerticalOffset={iosOffset}
        pointerEvents={pointerEvents}
      >
        {children}
      </KeyboardAvoidingView>
    );
  }

  return (
    <View
      ref={viewRef}
      onLayout={handleLayout}
      pointerEvents={pointerEvents}
      style={[{ flex: 1 }, style, androidBottomPad > 0 ? { paddingBottom: androidBottomPad } : null]}
    >
      {children}
    </View>
  );
}
