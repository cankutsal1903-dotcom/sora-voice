let cachedAgoraModule;

export const loadAgoraModule = () => {
  if (cachedAgoraModule !== undefined) return cachedAgoraModule;
  try {
    // eslint-disable-next-line global-require
    cachedAgoraModule = require("react-native-agora");
  } catch {
    cachedAgoraModule = null;
  }
  return cachedAgoraModule;
};

