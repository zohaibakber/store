import { ArrowLeft01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { useCatalogIsReady } from "@store/inventory-react";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import * as React from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, space, touch } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";

import {
  type CategoryChoice,
  type ExecutablePlan,
  type ScanMatch,
  identityOf,
  useCategoryChoices,
  useScanCommit,
  useScanMatch,
} from "../catalog";
import { useScanDraft, useScanDrafts } from "../drafts";
import {
  type CommitChoice,
  type ReviewValues,
  type ScanField,
  commitLabel,
  commitSummary,
  deriveFieldFlags,
  editedFields,
  editsFrom,
  mergeAutoFill,
  planCommit,
  reviewValuesWith,
  valueFromChip,
} from "../fields";
import { LOW_CONFIDENCE, type ScanDraft, canRetryParse } from "../model";
import { FieldRow, InfoRow, StepperRow } from "../review/field-row";
import {
  Banner,
  CategoryPicker,
  CommitBar,
  MatchCard,
  SourceStrip,
  TextChips,
} from "../review/parts";
import { ProductPicker } from "../review/product-picker";
import { countdownSeconds } from "../status";
import { ConfirmDialog, type ConfirmRequest } from "../ui/confirm-dialog";
import { useNow } from "../use-now";

type CatalogBinding = {
  readonly match: ScanMatch | null;
  readonly matching: boolean;
  readonly categories: ReadonlyArray<CategoryChoice>;
  readonly preferredCategoryId: string | null;
  readonly commit: (plan: ExecutablePlan, categoryId: string | null) => Promise<void>;
};

const FIELD_LABELS = {
  name: "Product name",
  composition: "Composition",
  strength: "Strength",
  unitsPerPack: "Units per pack",
  batchNumber: "Batch number",
  expiresAt: "Expiry",
} satisfies { readonly [Field in ScanField]: string };

const FIELD_PLACEHOLDERS = {
  name: "As printed on the pack",
  composition: "Active ingredients",
  strength: "For example 500mg",
  unitsPerPack: "For example 10",
  batchNumber: "B.No or LOT",
  expiresAt: "MM/YYYY",
} satisfies { readonly [Field in ScanField]: string };

const PRODUCT_FIELDS: ReadonlyArray<ScanField> = [
  "name",
  "composition",
  "strength",
  "unitsPerPack",
];
const BATCH_FIELDS: ReadonlyArray<ScanField> = ["batchNumber", "expiresAt"];
const ALL_FIELDS: ReadonlyArray<ScanField> = [...PRODUCT_FIELDS, ...BATCH_FIELDS];

const FILLED_REASON = "Filled in from the label · tap to confirm";
const EDIT_SAVE_DELAY_MILLIS = 700;

const failureMessage = (cause: unknown) =>
  cause instanceof Error && cause.message ? cause.message : "Could not save on this phone.";

const firstWord = (text: string) => text.trim().split(/\s+/)[0] ?? "";

function StatusBanner({
  draft,
  filledCount,
}: {
  readonly draft: ScanDraft;
  readonly filledCount: number;
}) {
  const { online, parsing, requestParse } = useScanDrafts();
  const { parse } = draft;
  const inFlight = parsing.has(draft.id);
  const now = useNow(parse._tag === "RateLimited");
  const retry = { label: "Try again", onPress: () => requestParse(draft.id) };
  if (inFlight && parse._tag !== "RateLimited") {
    return (
      <Banner tone="warning" message="Auto-filling from the label. Keep typing if you like." />
    );
  }
  switch (parse._tag) {
    case "Waiting":
    case "Deferred":
      return online ? (
        <Banner
          tone="warning"
          message="Auto-fill is waiting."
          action={{ label: "Auto-fill now", onPress: () => requestParse(draft.id) }}
        />
      ) : (
        <Banner
          tone="offline"
          message="Offline, so no auto-fill. Tap the recognised text below to fill fields."
        />
      );
    case "RateLimited": {
      const seconds = countdownSeconds(parse.retryAt, now);
      return (
        <Banner
          tone="warning"
          message={
            seconds > 0
              ? `Too many scans. Auto-fill resumes in ${seconds} s, or fill in by hand.`
              : "Auto-fill resumes shortly."
          }
        />
      );
    }
    case "Failed":
      return (
        <Banner
          tone="warning"
          message={`${parse.reason} Fill in by hand.`}
          action={online && canRetryParse(parse) ? retry : undefined}
        />
      );
    case "Parsed":
      if (filledCount > 0) {
        return (
          <Banner
            tone="warning"
            message={`Auto-fill added ${filledCount} ${filledCount === 1 ? "field" : "fields"}. Your edits were kept.`}
          />
        );
      }
      return parse.result.confidence < LOW_CONFIDENCE ? (
        <Banner tone="warning" message="Low confidence. Check every highlighted field." />
      ) : null;
    case "Manual":
      return null;
  }
}

const useReviewForm = (draft: ScanDraft) => {
  const { saveEdits, removeDraft, setPacks } = useScanDrafts();
  const parsed = draft.parse._tag === "Parsed" ? draft.parse.result : null;
  const parsedAt = draft.parse._tag === "Parsed" ? draft.parse.parsedAt : null;
  const [values, setValues] = React.useState<ReviewValues>(() =>
    reviewValuesWith(parsed, draft.edits),
  );
  const [edited, setEdited] = React.useState(() => editedFields(draft.edits));
  const [confirmed, setConfirmed] = React.useState<ReadonlySet<ScanField>>(() => new Set());
  const [filled, setFilled] = React.useState<ReadonlySet<ScanField>>(() => new Set());
  const [seenParsedAt, setSeenParsedAt] = React.useState(parsedAt);
  const [packs, setPackCount] = React.useState(draft.packs);
  const [picked, setPicked] = React.useState<ScanMatch | null>(null);
  const [override, setOverride] = React.useState<CommitChoice | null>(null);
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  if (parsedAt !== seenParsedAt) {
    setSeenParsedAt(parsedAt);
    if (parsed !== null) {
      const merged = mergeAutoFill(values, edited, parsed);
      setValues(merged.values);
      if (edited.size > 0 && merged.filled.length > 0) {
        setFilled(new Set([...filled, ...merged.filled]));
      }
    }
  }

  const derived = React.useMemo(
    () => deriveFieldFlags(parsed, draft.recognizedText),
    [parsed, draft.recognizedText],
  );
  const flagFor = (field: ScanField): string | null => {
    if (edited.has(field) || confirmed.has(field)) return null;
    if (filled.has(field)) return derived[field] ?? FILLED_REASON;
    return derived[field];
  };

  const change = (field: ScanField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setEdited((current) => (current.has(field) ? current : new Set(current).add(field)));
  };
  const confirm = (field: ScanField) =>
    setConfirmed((current) => (current.has(field) ? current : new Set(current).add(field)));
  const changePacks = (next: number) => {
    setPackCount(next);
    setPacks(draft.id, next);
  };

  const edits = React.useMemo(() => editsFrom(values, edited), [values, edited]);
  React.useEffect(() => {
    const timer = setTimeout(() => saveEdits(draft.id, edits), EDIT_SAVE_DELAY_MILLIS);
    return () => clearTimeout(timer);
  }, [draft.id, edits, saveEdits]);

  const typedEntry = draft.photoUri === null && draft.recognizedText.trim() === "";
  const latestEdits = React.useRef(edits);
  React.useEffect(() => {
    latestEdits.current = edits;
  }, [edits]);
  React.useEffect(
    () => () => {
      const pending = latestEdits.current;
      if (typedEntry && editedFields(pending).size === 0) removeDraft(draft.id);
      else saveEdits(draft.id, pending);
    },
    [typedEntry, removeDraft, saveEdits, draft.id],
  );

  return {
    parsed,
    values,
    edited,
    filled,
    packs,
    picked,
    override,
    categoryId,
    saving,
    typedEntry,
    flagFor,
    change,
    confirm,
    changePacks,
    setPicked,
    setOverride,
    setCategoryId,
    setSaving,
  };
};

type ReviewForm = ReturnType<typeof useReviewForm>;

function ReviewBody({
  draft,
  form,
  catalog,
}: {
  readonly draft: ScanDraft;
  readonly form: ReviewForm;
  readonly catalog: CatalogBinding | null;
}) {
  const insets = useSafeAreaInsets();
  const { online, removeDraft, setParse, noteCommit } = useScanDrafts();
  const [focused, setFocused] = React.useState<ScanField | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [confirmRequest, setConfirmRequest] = React.useState<ConfirmRequest | null>(null);

  const { parsed, values, packs } = form;
  const existing = form.picked ?? catalog?.match ?? null;
  const choice: CommitChoice = existing === null ? "newProduct" : (form.override ?? "addBatch");
  const product = choice === "addBatch" ? (existing?.product ?? null) : null;
  const fields = choice === "addBatch" ? BATCH_FIELDS : ALL_FIELDS;
  const awaitingAutoFill = parsed === null && draft.parse._tag !== "Manual";
  const label = commitLabel(choice, values, packs, product);
  const selectedCategory = form.categoryId ?? catalog?.preferredCategoryId ?? null;

  const change = (field: ScanField, value: string) => {
    form.change(field, value);
    setError(null);
  };

  const commit = async () => {
    if (catalog === null || form.saving) return;
    const plan = planCommit(choice, values, packs, product);
    if (plan._tag === "Invalid") {
      setError(plan.message);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    form.setSaving(true);
    try {
      await catalog.commit(plan, selectedCategory);
    } catch (cause) {
      setError(failureMessage(cause));
      form.setSaving(false);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    noteCommit(commitSummary(choice, values, packs, product));
    removeDraft(draft.id);
    router.back();
  };

  const autoFillLater = () => {
    setParse(draft.id, { _tag: "Deferred" });
    router.back();
  };

  const discard = () => {
    const drop = () => {
      removeDraft(draft.id);
      router.back();
    };
    if (form.typedEntry && form.edited.size === 0) {
      drop();
      return;
    }
    setConfirmRequest({
      title: "Discard this scan?",
      body:
        draft.photoUri === null
          ? "What you typed is deleted from this phone."
          : "The photo and anything you typed are deleted from this phone.",
      confirmLabel: "Discard",
      cancelLabel: "Keep",
      onConfirm: drop,
    });
  };

  const pickProduct = (match: ScanMatch) => {
    form.setPicked(match);
    form.setOverride("addBatch");
    setPickerOpen(false);
    setError(null);
  };

  const pickNewProduct = () => {
    form.setOverride("newProduct");
    setPickerOpen(false);
    setError(null);
  };

  return (
    <KeyboardAvoidingView behavior="height" style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back. This scan stays in saved scans"
          onPress={() => router.back()}
          style={styles.headerButton}
        >
          <Icon icon={ArrowLeft01Icon} />
        </Pressable>
        <Text size="lg" weight="medium" style={styles.headerTitle}>
          Review scan
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discard this scan"
          onPress={discard}
          style={styles.headerButton}
        >
          <Icon icon={Delete02Icon} />
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <StatusBanner draft={draft} filledCount={form.filled.size} />
        <SourceStrip
          photoUri={draft.photoUri}
          text={draft.recognizedText}
          initiallyExpanded={parsed === null || parsed.confidence < LOW_CONFIDENCE}
        />
        {catalog === null ? (
          <Banner tone="warning" message="Your stock is still opening on this phone." />
        ) : (
          <MatchCard
            match={existing}
            source={form.picked === null ? "auto" : "picked"}
            matching={catalog.matching && form.picked === null}
            choice={choice}
            onChoose={form.setOverride}
            onPick={() => setPickerOpen(true)}
          />
        )}
        <View>
          {fields.map((field) => (
            <FieldRow
              key={field}
              label={FIELD_LABELS[field]}
              value={values[field]}
              flag={form.flagFor(field)}
              placeholder={FIELD_PLACEHOLDERS[field]}
              keyboardType={field === "unitsPerPack" ? "number-pad" : "default"}
              autoCapitalize={field === "name" || field === "composition" ? "words" : "characters"}
              onChange={(value) => change(field, value)}
              onFocus={() => setFocused(field)}
              onConfirm={() => form.confirm(field)}
            />
          ))}
          {product === null ? (
            <CategoryPicker
              choices={catalog?.categories ?? []}
              selectedId={selectedCategory}
              onSelect={form.setCategoryId}
            />
          ) : (
            <InfoRow label="Units per pack" value={String(product.unitsPerPack)} />
          )}
          <StepperRow
            label="Packs received"
            value={packs}
            unit={packs === 1 ? "pack" : "packs"}
            onChange={form.changePacks}
          />
        </View>
        <TextChips
          lines={draft.lines}
          target={focused === null ? null : FIELD_LABELS[focused].toLowerCase()}
          onPick={(line) => {
            if (focused !== null) change(focused, valueFromChip(focused, line));
          }}
        />
      </ScrollView>
      <View style={{ paddingBottom: insets.bottom + space[2] }}>
        <CommitBar
          label={label}
          caption={
            online
              ? "Saved on this phone first, then synced"
              : "Saved on this phone now, synced when you're back online"
          }
          error={error}
          enabled={catalog !== null && !form.saving}
          onCommit={() => void commit()}
          secondary={
            awaitingAutoFill && draft.photoUri !== null
              ? { label: "Auto-fill later", onPress: autoFillLater }
              : undefined
          }
        />
      </View>
      {catalog === null ? null : (
        <ProductPicker
          open={pickerOpen}
          initialQuery={firstWord(values.name)}
          selectedId={product?.id ?? null}
          newName={values.name}
          onPick={pickProduct}
          onNewProduct={pickNewProduct}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </KeyboardAvoidingView>
  );
}

function ReviewWithCatalog({
  draft,
  form,
}: {
  readonly draft: ScanDraft;
  readonly form: ReviewForm;
}) {
  const { match, isLoading } = useScanMatch(identityOf(draft));
  const { choices, preferredId } = useCategoryChoices();
  const commit = useScanCommit();
  const catalog: CatalogBinding = {
    match,
    matching: isLoading,
    categories: choices,
    preferredCategoryId: preferredId,
    commit,
  };
  return <ReviewBody draft={draft} form={form} catalog={catalog} />;
}

function ReviewEditor({ draft }: { readonly draft: ScanDraft }) {
  const catalogReady = useCatalogIsReady();
  const form = useReviewForm(draft);
  return catalogReady ? (
    <ReviewWithCatalog draft={draft} form={form} />
  ) : (
    <ReviewBody draft={draft} form={form} catalog={null} />
  );
}

export function ReviewScreen() {
  const { draftId } = useLocalSearchParams<{ draftId?: string }>();
  const current = useScanDraft(draftId);
  const { loaded } = useScanDrafts();
  const [kept, setKept] = React.useState(current);
  if (current !== null && current !== kept) setKept(current);
  const draft = current ?? kept;
  if (draft === null) {
    return (
      <View style={[styles.screen, styles.missing]}>
        <Text size="base" tone="muted">
          {loaded ? "This scan is no longer here." : "Opening the scan…"}
        </Text>
      </View>
    );
  }
  return <ReviewEditor key={draft.id} draft={draft} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  missing: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[1],
    minHeight: 56,
  },
  headerButton: {
    width: touch.minimum,
    height: touch.minimum,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1 },
  content: { gap: space[4], padding: space[4], paddingBottom: space[8] },
});
