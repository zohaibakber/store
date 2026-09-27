import { BottomSheet, RNHostView } from "@expo/ui";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import * as React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  FadeIn,
  LinearTransition,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { colors, motion, radius, space, touch } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";

export type SheetPhase =
  | { readonly _tag: "Reading" }
  | { readonly _tag: "Parsing"; readonly words: number }
  | { readonly _tag: "Matching"; readonly words: number }
  | { readonly _tag: "RateLimited"; readonly words: number; readonly seconds: number }
  | {
      readonly _tag: "Failed";
      readonly words: number;
      readonly reason: string;
      readonly canRetry: boolean;
    }
  | { readonly _tag: "NoText" };

type StepState = "done" | "active" | "waiting" | "stopped";

const stepIndex = (phase: SheetPhase): number => {
  switch (phase._tag) {
    case "Reading":
    case "NoText":
      return 0;
    case "Parsing":
    case "RateLimited":
    case "Failed":
      return 1;
    case "Matching":
      return 2;
  }
};

const stopped = (phase: SheetPhase) =>
  phase._tag === "RateLimited" || phase._tag === "Failed" || phase._tag === "NoText";

const wordsText = (phase: SheetPhase): string | null =>
  "words" in phase ? `${phase.words} ${phase.words === 1 ? "word" : "words"}` : null;

function ActiveDot() {
  const pulse = useSharedValue(0);
  React.useEffect(() => {
    pulse.set(withRepeat(withTiming(1, { duration: motion.emphasized * 1.5 }), -1, true));
  }, [pulse]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.get(), [0, 1], [0.35, 1]),
    transform: [{ scale: interpolate(pulse.get(), [0, 1], [0.8, 1.1]) }],
  }));
  return <Animated.View style={[styles.dot, styles.dotActive, style]} />;
}

function StepIndicator({ state }: { readonly state: StepState }) {
  if (state === "done") {
    return (
      <Animated.View entering={FadeIn.duration(motion.quick)} style={[styles.dot, styles.dotDone]}>
        <Icon icon={Tick02Icon} size={14} strokeWidth={2} color={colors.ground} />
      </Animated.View>
    );
  }
  if (state === "active") return <ActiveDot />;
  if (state === "stopped") return <View style={[styles.dot, styles.dotStopped]} />;
  return <View style={[styles.dot, styles.dotWaiting]} />;
}

function Step({
  label,
  detail,
  state,
}: {
  readonly label: string;
  readonly detail: string | null;
  readonly state: StepState;
}) {
  return (
    <Animated.View layout={LinearTransition.duration(motion.quick)} style={styles.step}>
      <StepIndicator state={state} />
      <View style={styles.stepText}>
        <Text
          size="sm"
          weight={state === "active" ? "medium" : "regular"}
          tone={state === "waiting" ? "muted" : "ink"}
        >
          {label}
        </Text>
        {detail === null ? null : (
          <Text size="xs" tone="muted">
            {detail}
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

const STEP_LABELS = [
  "Text found on the phone",
  "Turning it into product fields",
  "Matching against your stock",
] as const;

const stepState = (phase: SheetPhase, index: number): StepState => {
  const current = stepIndex(phase);
  if (index < current) return "done";
  if (index > current) return "waiting";
  return stopped(phase) ? "stopped" : "active";
};

const stepDetail = (phase: SheetPhase, index: number): string | null => {
  if (index === 0) return phase._tag === "NoText" ? "No text found on the label" : wordsText(phase);
  if (index !== 1) return null;
  if (phase._tag === "RateLimited") {
    return phase.seconds > 0
      ? `Too many scans right now. Auto-fill resumes in ${phase.seconds} s.`
      : "Auto-fill resumes shortly.";
  }
  if (phase._tag === "Failed") return phase.reason;
  return null;
};

function SheetButton({
  label,
  onPress,
  primary = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.button, primary ? styles.buttonPrimary : styles.buttonSecondary]}
    >
      <Text size="sm" weight="medium" style={{ color: primary ? colors.ground : colors.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

function SheetContent({
  phase,
  onDiscard,
  onManual,
  onRetry,
}: {
  readonly phase: SheetPhase;
  readonly onDiscard: () => void;
  readonly onManual: () => void;
  readonly onRetry: () => void;
}) {
  return (
    <View style={styles.content}>
      {STEP_LABELS.map((label, index) => (
        <Step
          key={label}
          label={label}
          detail={stepDetail(phase, index)}
          state={stepState(phase, index)}
        />
      ))}
      <View style={styles.actions}>
        <SheetButton label="Retake" onPress={onDiscard} />
        {phase._tag === "Failed" && phase.canRetry ? (
          <SheetButton label="Try again" onPress={onRetry} />
        ) : null}
        <SheetButton label="Fill in by hand" onPress={onManual} primary />
      </View>
    </View>
  );
}

export function ParsingSheet({
  phase,
  onDiscard,
  onKeep,
  onManual,
  onRetry,
}: {
  readonly phase: SheetPhase | null;
  readonly onDiscard: () => void;
  readonly onKeep: () => void;
  readonly onManual: () => void;
  readonly onRetry: () => void;
}) {
  const [shown, setShown] = React.useState<SheetPhase>(phase ?? { _tag: "Reading" });
  if (phase !== null && phase !== shown) setShown(phase);
  return (
    <BottomSheet
      isPresented={phase !== null}
      onDismiss={onKeep}
      showDragIndicator={false}
      shouldDismissOnClickOutside={false}
      containerColor={colors.ground}
      snapPoints={["half"]}
    >
      <RNHostView matchContents>
        <SheetContent phase={shown} onDiscard={onDiscard} onManual={onManual} onRetry={onRetry} />
      </RNHostView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space[2], paddingBottom: space[6], gap: space[4] },
  step: { flexDirection: "row", alignItems: "flex-start", gap: space[3], minHeight: 40 },
  stepText: { flex: 1, gap: 2 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  dotDone: { backgroundColor: colors.ink },
  dotActive: { backgroundColor: colors.highlight },
  dotWaiting: { borderWidth: 2, borderColor: colors.hairline },
  dotStopped: { borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.highlight },
  actions: { flexDirection: "row", gap: space[2], marginTop: space[2] },
  button: {
    flex: 1,
    minHeight: touch.minimum,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[3],
    borderRadius: radius.md,
  },
  buttonPrimary: { backgroundColor: colors.ink },
  buttonSecondary: { borderWidth: 1, borderColor: colors.hairline },
});
