import * as Haptics from "expo-haptics";

const isIos = process.env.EXPO_OS === "ios";

export const hapticSelection = () => {
  if (!isIos) return;
  void Haptics.selectionAsync();
};

export const hapticSuccess = () => {
  if (!isIos) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
};

export const hapticWarning = () => {
  if (!isIos) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
};

export const hapticError = () => {
  if (!isIos) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
};
