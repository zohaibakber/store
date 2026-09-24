import { ArrowLeft01Icon, FlashIcon, FlashOffIcon, KeyboardIcon } from "@hugeicons/core-free-icons";
import { useCatalogIsReady } from "@store/inventory-react";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router, useFocusEffect, useIsFocused, useLocalSearchParams } from "expo-router";
import { setStatusBarStyle } from "expo-status-bar";
import * as React from "react";
import { AppState, Linking, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CommonResolutions,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from "react-native-vision-camera";

import { colors, motion, radius, space, touch } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";

import { captureScan } from "../camera/capture";
import {
  CameraIconButton,
  CaptureChip,
  LastScanThumbnail,
  ModeToggle,
  Shutter,
  StatusChip,
  Tray,
  type TrayItem,
} from "../camera/controls";
import {
  EMPTY_LIVE_TEXT,
  type LiveTextFrame,
  ScanCamera,
  liveTextAvailable,
} from "../camera/scan-camera";
import { TextOverlay } from "../camera/text-overlay";
import { identityOf, useScanMatch } from "../catalog";
import { useScanDrafts } from "../drafts";
import { type ProductScanMode, type ScanDraft, canRetryParse } from "../model";
import { ParsingSheet, type SheetPhase } from "../parsing-sheet";
import { INITIAL_STABILITY, markCaptured, stepStability } from "../stability";
import { countdownSeconds, draftStatus } from "../status";
import { useNow } from "../use-now";

type SessionState = "idle" | "open" | "kept" | "discarded";

type ProductSession = {
  readonly draftId: string | null;
  readonly frozenUri: string | null;
  readonly wantsManual: boolean;
};

const wordCount = (text: string) => text.split(/\s+/).filter((word) => word.length > 0).length;

const CAPTURED_MESSAGE = "Captured · move to the next item";
const KEPT_MESSAGE = "Kept in saved scans";
const COMMITTED_MESSAGE = "Saved · syncing";

const openReview = (draftId: string) =>
  router.push({ pathname: "/scan/review", params: { draftId } });

const sheetPhaseFor = (
  draft: ScanDraft | null,
  inFlight: boolean,
  online: boolean,
  now: number,
): SheetPhase => {
  if (draft === null) return { _tag: "Reading" };
  const words = wordCount(draft.recognizedText);
  const { parse } = draft;
  if (parse._tag === "RateLimited") {
    return { _tag: "RateLimited", words, seconds: countdownSeconds(parse.retryAt, now) };
  }
  if (inFlight) return { _tag: "Parsing", words };
  switch (parse._tag) {
    case "Waiting":
    case "Deferred":
      return { _tag: "Parsing", words };
    case "Failed":
      return {
        _tag: "Failed",
        words,
        reason: parse.reason,
        canRetry: online && canRetryParse(parse),
      };
    case "Manual":
      return words === 0 ? { _tag: "NoText" } : { _tag: "Parsing", words };
    case "Parsed":
      return { _tag: "Matching", words };
  }
};

const readyForReview = (draft: ScanDraft): boolean =>
  draft.parse._tag === "Deferred" ||
  (draft.parse._tag === "Manual" && draft.recognizedText.trim() !== "");

function MatchProbe({
  draft,
  onSettled,
}: {
  readonly draft: ScanDraft;
  readonly onSettled: () => void;
}) {
  const { isLoading } = useScanMatch(identityOf(draft));
  React.useEffect(() => {
    if (!isLoading) onSettled();
  }, [isLoading, onSettled]);
  return null;
}

const useAppActive = () => {
  const [active, setActive] = React.useState(AppState.currentState === "active");
  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  return active;
};

function PermissionPrompt({
  canAsk,
  onAsk,
  onType,
}: {
  readonly canAsk: boolean;
  readonly onAsk: () => void;
  readonly onType: () => void;
}) {
  return (
    <View style={styles.permission}>
      <Text size="lg" weight="medium" tone="onCamera">
        Camera access is off
      </Text>
      <Text size="sm" tone="onCamera" style={styles.permissionText}>
        Scanning reads the label on the pack. You can also type the details instead.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={canAsk ? onAsk : () => void Linking.openSettings()}
        style={styles.permissionButton}
      >
        <Text size="base" weight="medium">
          {canAsk ? "Allow camera" : "Open settings"}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onType} style={styles.textButton}>
        <Text size="sm" weight="medium" tone="onCamera">
          Type instead
        </Text>
      </Pressable>
    </View>
  );
}

export function CameraScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const permission = useCameraPermission();
  const device = useCameraDevice("back");
  const photoOutput = usePhotoOutput({
    targetResolution: CommonResolutions.FHD_4_3,
    quality: 0.85,
    qualityPrioritization: "balanced",
  });
  const drafts = useScanDrafts();
  const catalogReady = useCatalogIsReady();

  const [mode, setMode] = React.useState<ProductScanMode>(
    params.mode === "batch" ? "batch" : "product",
  );
  const [torch, setTorch] = React.useState(false);
  const [autoCapture, setAutoCapture] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [chip, setChip] = React.useState<string | null>(null);
  const [session, setSession] = React.useState<ProductSession | null>(null);

  const liveFrame = useSharedValue<LiveTextFrame>(EMPTY_LIVE_TEXT);
  const liveTextRef = React.useRef<LiveTextFrame>(EMPTY_LIVE_TEXT);
  const stabilityRef = React.useRef(INITIAL_STABILITY);
  const busyRef = React.useRef(false);
  const sessionRef = React.useRef<SessionState>("idle");
  const reviewedRef = React.useRef<string | null>(null);
  const autoRef = React.useRef({ mode, autoCapture });
  const flash = useSharedValue(0);

  const { hasPermission, canRequestPermission, requestPermission } = permission;
  React.useEffect(() => {
    if (!hasPermission && canRequestPermission) void requestPermission();
  }, [hasPermission, canRequestPermission, requestPermission]);

  React.useEffect(() => {
    autoRef.current = { mode, autoCapture };
  }, [mode, autoCapture]);

  useFocusEffect(
    React.useCallback(() => {
      setStatusBarStyle("light");
      return () => setStatusBarStyle("dark");
    }, []),
  );

  React.useEffect(() => {
    if (chip === null) return;
    const timer = setTimeout(() => setChip(null), 1600);
    return () => clearTimeout(timer);
  }, [chip]);

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.get() }));

  const startCapture = () => {
    busyRef.current = true;
    setBusy(true);
    flash.set(
      withSequence(withTiming(0.7, { duration: 60 }), withTiming(0, { duration: motion.standard })),
    );
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const finishCapture = () => {
    busyRef.current = false;
    setBusy(false);
  };

  const captureBatch = async () => {
    if (busyRef.current) return;
    startCapture();
    try {
      const shot = await captureScan(photoOutput, liveTextRef.current);
      stabilityRef.current = markCaptured(stabilityRef.current, shot.text, Date.now());
      const draft = await drafts.createDraft({
        mode: "batch",
        capturedPath: shot.path,
        recognizedText: shot.text,
        lines: shot.lines,
      });
      drafts.requestParse(draft.id);
      setChip(CAPTURED_MESSAGE);
    } catch {
      setChip("Couldn't take the photo. Try again.");
    } finally {
      finishCapture();
    }
  };

  const sessionOutcome = (): SessionState => sessionRef.current;

  const captureProduct = async () => {
    if (busyRef.current) return;
    startCapture();
    sessionRef.current = "open";
    reviewedRef.current = null;
    setSession({ draftId: null, frozenUri: null, wantsManual: false });
    try {
      const shot = await captureScan(photoOutput, liveTextRef.current);
      const draft = await drafts.createDraft({
        mode: "product",
        capturedPath: shot.path,
        recognizedText: shot.text,
        lines: shot.lines,
      });
      const outcome = sessionOutcome();
      if (outcome === "discarded") {
        drafts.removeDraft(draft.id);
        return;
      }
      if (draft.parse._tag === "Waiting") drafts.requestParse(draft.id);
      if (outcome !== "open") return;
      setSession((current) =>
        current === null ? null : { ...current, draftId: draft.id, frozenUri: draft.photoUri },
      );
    } catch {
      sessionRef.current = "idle";
      setSession(null);
      setChip("Couldn't take the photo. Try again.");
    } finally {
      finishCapture();
    }
  };

  const onLiveText = (frame: LiveTextFrame) => {
    liveTextRef.current = frame;
    liveFrame.set(frame);
    const settings = autoRef.current;
    if (settings.mode !== "batch" || !settings.autoCapture || busyRef.current) return;
    const step = stepStability(stabilityRef.current, frame.text, Date.now());
    stabilityRef.current = step.state;
    if (step.capture) void captureBatch();
  };

  const typeInstead = async () => {
    const draft = await drafts.createDraft({
      mode,
      capturedPath: null,
      recognizedText: "",
      lines: [],
    });
    openReview(draft.id);
  };

  const sessionDraftId = session === null ? null : session.draftId;
  const sessionDraft =
    sessionDraftId === null
      ? null
      : (drafts.drafts.find((draft) => draft.id === sessionDraftId) ?? null);
  const inFlight = sessionDraft !== null && drafts.parsing.has(sessionDraft.id);
  const now = useNow(sessionDraft?.parse._tag === "RateLimited");
  const phase = session === null ? null : sheetPhaseFor(sessionDraft, inFlight, drafts.online, now);

  const leaveToReview = React.useCallback((draftId: string) => {
    if (reviewedRef.current === draftId) return;
    reviewedRef.current = draftId;
    sessionRef.current = "idle";
    openReview(draftId);
    setSession(null);
  }, []);

  React.useEffect(() => {
    if (sessionDraft === null || inFlight) return;
    if (session?.wantsManual === true || readyForReview(sessionDraft)) {
      leaveToReview(sessionDraft.id);
    } else if (sessionDraft.parse._tag === "Parsed" && !catalogReady) {
      leaveToReview(sessionDraft.id);
    }
  }, [sessionDraft, inFlight, session?.wantsManual, catalogReady, leaveToReview]);

  const discardSession = () => {
    if (sessionRef.current !== "open") return;
    sessionRef.current = "discarded";
    if (sessionDraftId !== null) drafts.removeDraft(sessionDraftId);
    setSession(null);
  };

  const keepSession = () => {
    if (sessionRef.current !== "open") return;
    sessionRef.current = "kept";
    setSession(null);
    setChip(KEPT_MESSAGE);
  };

  const fillByHand = () => {
    if (sessionDraftId !== null) leaveToReview(sessionDraftId);
    else setSession((current) => (current === null ? null : { ...current, wantsManual: true }));
  };

  const retryParse = () => {
    if (sessionDraftId !== null) drafts.requestParse(sessionDraftId);
  };

  const batchItems: ReadonlyArray<TrayItem> = drafts.drafts
    .filter((draft) => draft.mode === "batch")
    .map((draft) => ({
      id: draft.id,
      photoUri: draft.photoUri,
      status: draftStatus(draft, drafts.parsing.has(draft.id), null),
    }));
  const lastPhoto = drafts.drafts.find((draft) => draft.photoUri !== null)?.photoUri ?? null;
  const frozenUri = session === null ? null : session.frozenUri;
  const cameraActive = focused && appActive && frozenUri === null;
  const autoOn = mode === "batch" && autoCapture;
  const message = chip ?? (drafts.lastCommit === null ? null : COMMITTED_MESSAGE);
  const messageDetail = chip === null ? drafts.lastCommit : null;

  return (
    <View style={styles.screen}>
      {hasPermission && device !== undefined ? (
        <ScanCamera
          device={device}
          active={cameraActive}
          torch={torch}
          photoOutput={photoOutput}
          onLiveText={onLiveText}
          onPreviewStarted={() => undefined}
          onError={() => setChip("The camera stopped. Close and reopen scan.")}
        />
      ) : null}
      {hasPermission ? <TextOverlay frame={liveFrame} /> : null}
      {frozenUri === null ? null : (
        <Image source={{ uri: frozenUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      )}
      <Animated.View pointerEvents="none" style={[styles.flash, flashStyle]} />
      {hasPermission ? null : (
        <PermissionPrompt
          canAsk={canRequestPermission}
          onAsk={() => void requestPermission()}
          onType={() => void typeInstead()}
        />
      )}

      <View style={[styles.topBar, { paddingTop: insets.top + space[2] }]}>
        <CameraIconButton icon={ArrowLeft01Icon} label="Close scan" onPress={() => router.back()} />
        <StatusChip
          online={drafts.online}
          draftCount={drafts.drafts.length}
          onPress={() => router.push("/scan/drafts")}
        />
        {device?.hasTorch ? (
          <CameraIconButton
            icon={torch ? FlashIcon : FlashOffIcon}
            label={torch ? "Turn light off" : "Turn light on"}
            active={torch}
            onPress={() => setTorch((current) => !current)}
          />
        ) : (
          <View style={styles.topSpacer} />
        )}
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space[4] }]}>
        <CaptureChip message={message} detail={messageDetail} />
        {mode === "batch" ? <Tray items={batchItems} /> : null}
        {!liveTextAvailable && mode === "batch" ? (
          <Text size="xs" tone="onCamera" style={styles.hint}>
            Auto-capture needs live text. Tap the shutter for each item.
          </Text>
        ) : null}
        <ModeToggle mode={mode} onChange={setMode} />
        <View style={styles.controls}>
          <View style={styles.side}>
            {mode === "batch" ? (
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: autoCapture }}
                onPress={() => setAutoCapture((current) => !current)}
                style={[styles.pill, autoCapture && styles.pillOn]}
              >
                <Text
                  size="xs"
                  weight="medium"
                  style={{ color: autoCapture ? colors.ink : colors.onCamera }}
                >
                  {autoCapture ? "Auto on" : "Auto off"}
                </Text>
              </Pressable>
            ) : (
              <LastScanThumbnail uri={lastPhoto} onPress={() => router.push("/scan/drafts")} />
            )}
          </View>
          <Shutter
            auto={autoOn}
            busy={busy || !hasPermission || (mode === "product" && session !== null)}
            onPress={() => void (mode === "batch" ? captureBatch() : captureProduct())}
          />
          <View style={styles.side}>
            {mode === "batch" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Review ${batchItems.length} scans`}
                disabled={batchItems.length === 0}
                onPress={() => router.push("/scan/batch")}
                style={[styles.pill, styles.reviewPill, batchItems.length === 0 && styles.disabled]}
              >
                <Text size="sm" weight="medium">
                  {batchItems.length === 0 ? "Review" : `Review ${batchItems.length}`}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Type instead"
                onPress={() => void typeInstead()}
                style={styles.typeButton}
              >
                <Icon icon={KeyboardIcon} size={22} color={colors.onCamera} />
                <Text size="xs" tone="onCamera">
                  Type instead
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {mode === "product" ? (
        <ParsingSheet
          phase={phase}
          onDiscard={discardSession}
          onKeep={keepSession}
          onManual={fillByHand}
          onRetry={retryParse}
        />
      ) : null}
      {catalogReady && sessionDraft !== null && phase?._tag === "Matching" ? (
        <MatchProbe draft={sessionDraft} onSettled={() => leaveToReview(sessionDraft.id)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.camera },
  flash: { ...StyleSheet.absoluteFill, backgroundColor: colors.onCamera },
  topBar: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[4],
  },
  topSpacer: { width: touch.minimum },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    gap: space[4],
    paddingTop: space[4],
    backgroundColor: colors.cameraScrim,
  },
  hint: { textAlign: "center", paddingHorizontal: space[6] },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[6],
  },
  side: { width: 96, alignItems: "center" },
  pill: {
    minHeight: touch.minimum,
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    backgroundColor: colors.cameraChip,
  },
  pillOn: { backgroundColor: colors.highlight },
  reviewPill: { backgroundColor: colors.onCamera },
  disabled: { opacity: 0.4 },
  typeButton: {
    minHeight: touch.minimum,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  permission: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: space[4],
    padding: space[8],
  },
  permissionText: { textAlign: "center" },
  permissionButton: {
    minHeight: touch.primary,
    minWidth: 200,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.onCamera,
  },
  textButton: { minHeight: touch.minimum, justifyContent: "center" },
});
