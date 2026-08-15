import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  Alert as HeroAlert,
  Badge,
  Button,
  Card,
  ChoiceChip,
  Input,
  Label,
  TextField,
  useThemeColor,
} from "@/components/mobile-ui";
import { InlineTextCamera } from "@/features/product-scanner/inline-text-camera";
import { expiryInputValue, expiryTimestamp } from "@/features/product-scanner/local-parser";
import { findProductMatch } from "@/features/product-scanner/product-match";
import { PackQuantitySheet, UnitQuantitySheet } from "@/features/product-scanner/quantity-sheet";
import { inferProductText } from "@/features/product-scanner/scan-api";
import type { ProductScanInference, ProductScanMode } from "@/features/product-scanner/types";
import {
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import { authErrorMessage } from "@/lib/auth-client";
import { createInventoryEntityId } from "@/lib/products";

const normalizeKey = (value: string | null) => value?.trim().toLocaleLowerCase() ?? "";

export default function ProductScanScreen() {
  const { products, categories } = useProductData();
  const { loading } = useProductStatus();
  const { saveScannedProduct, saveBatchDetails, updateBatchQuantity } = useProductActions();
  const scroll = useRef<ScrollView>(null);
  const [mode, setMode] = useState<ProductScanMode>("product");
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [savingBatch, setSavingBatch] = useState(false);
  const [savingQuantity, setSavingQuantity] = useState(false);
  const [cameraReading, setCameraReading] = useState(false);
  const [screenFocused, setScreenFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [quantityOpen, setQuantityOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [productInference, setProductInference] = useState<ProductScanInference | null>(null);
  const [batchInference, setBatchInference] = useState<ProductScanInference | null>(null);
  const [matchedProductId, setMatchedProductId] = useState<string | null>(null);
  const [savedProductId, setSavedProductId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [composition, setComposition] = useState("");
  const [strength, setStrength] = useState("");
  const [unitsPerPack, setUnitsPerPack] = useState("1");
  const [categoryId, setCategoryId] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [newProductId, setNewProductId] = useState(createInventoryEntityId);
  const [newBatchId, setNewBatchId] = useState(createInventoryEntityId);
  const [background, foreground, muted, subtle] = useThemeColor([
    "background",
    "foreground",
    "muted",
    "surface-secondary",
  ]);

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppActive(state === "active");
    });
    return () => subscription.remove();
  }, []);

  const matchedProduct = products.find((product) => product.id === matchedProductId) ?? null;
  const activeProduct =
    products.find((product) => product.id === (savedProductId ?? matchedProductId)) ?? null;
  const selectedBatch =
    activeProduct?.batches.find((batch) => batch.id === selectedBatchId) ?? null;
  const selectedCategory = categories.find((category) => category.id === categoryId) ?? null;
  const cameraBusy = cameraReading || analyzing;
  const cameraActive = screenFocused && appActive && !quantityOpen;
  const cameraStatus = !cameraActive
    ? "paused"
    : loading
      ? "syncing"
      : analyzing
        ? "analyzing"
        : "ready";
  const confidence = productInference
    ? `${Math.round(productInference.confidence * 100)}% confidence`
    : null;

  const sourceLabel = useMemo(() => {
    if (!productInference) return null;
    return productInference.source === "cloud" ? "AI structured" : "On-device result";
  }, [productInference]);

  const resetCamera = (nextMode: ProductScanMode) => {
    setMode(nextMode);
    setCameraResetKey((current) => current + 1);
    if (nextMode === "batch") setBatchInference(null);
    setError(null);
    setNotice(null);
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  const applyBatchInference = (inference: ProductScanInference) => {
    const matchingBatch = activeProduct?.batches.find(
      (batch) =>
        inference.batchNumber &&
        normalizeKey(batch.batchNumber) === normalizeKey(inference.batchNumber),
    );
    const fallbackBatch = matchingBatch ?? (!inference.batchNumber ? selectedBatch : null);
    setBatchInference(inference);
    setBatchNumber(inference.batchNumber ?? fallbackBatch?.batchNumber ?? "");
    setExpiresAt(inference.expiresAt ?? expiryInputValue(fallbackBatch?.expiresAt ?? null));
    if (matchingBatch) setSelectedBatchId(matchingBatch.id);
    else if (inference.batchNumber) {
      setSelectedBatchId(null);
      setNewBatchId(createInventoryEntityId());
    }
  };

  const onCaptureStateChange = (capturing: boolean) => {
    setCameraReading(capturing);
    if (!capturing) return;
    setError(null);
    setNotice(null);
    if (mode === "batch") {
      setBatchInference(null);
      setNewBatchId(createInventoryEntityId());
      return;
    }
    setProductInference(null);
    setBatchInference(null);
    setMatchedProductId(null);
    setSavedProductId(null);
    setSelectedBatchId(null);
    setNewProductId(createInventoryEntityId());
    setNewBatchId(createInventoryEntityId());
  };

  const onTextDetected = async (recognizedText: string) => {
    setAnalyzing(true);
    setError(null);
    setNotice(null);
    try {
      const inference = await inferProductText(recognizedText, mode);
      if (mode === "batch") {
        applyBatchInference(inference);
        return;
      }

      const match = findProductMatch(products, inference, recognizedText);
      setProductInference(inference);
      setBatchInference(null);
      setMatchedProductId(match?.id ?? null);
      setSavedProductId(null);
      setSelectedBatchId(null);
      setName(inference.name ?? match?.name ?? "");
      setComposition(inference.composition ?? match?.composition ?? "");
      setStrength(inference.strength ?? match?.strength ?? "");
      setUnitsPerPack(String(inference.unitsPerPack ?? match?.unitsPerPack ?? 1));
      setCategoryId(match?.categoryId ?? categories[0]?.id ?? "");
      setBatchNumber(inference.batchNumber ?? "");
      setExpiresAt(inference.expiresAt ?? "");
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setAnalyzing(false);
    }
  };

  const confirmProduct = async () => {
    if (!name.trim()) {
      setError("Check the inferred product name before continuing.");
      return;
    }
    const parsedUnitsPerPack = Number(unitsPerPack.trim());
    if (
      !matchedProduct &&
      selectedCategory?.tracksPacks !== false &&
      (!Number.isSafeInteger(parsedUnitsPerPack) ||
        parsedUnitsPerPack < 1 ||
        parsedUnitsPerPack > 10_000)
    ) {
      setError("Units per pack must be a whole number from 1 to 10,000.");
      return;
    }
    setSavingProduct(true);
    setError(null);
    setNotice(null);
    try {
      const productDetails = {
        name,
        categoryId: matchedProduct?.categoryId ?? categoryId,
        composition: composition.trim() || null,
        strength: strength.trim() || null,
      };
      const product = await saveScannedProduct(
        matchedProduct
          ? { ...productDetails, productId: matchedProduct.id }
          : {
              ...productDetails,
              productId: null,
              newProductId,
              unitsPerPack: parsedUnitsPerPack,
            },
      );
      setSavedProductId(product.id);
      setMatchedProductId(product.id);
      setNewBatchId(createInventoryEntityId());
      const inferredBatch = product.batches.find(
        (batch) =>
          batchNumber.trim() &&
          normalizeKey(batch.batchNumber) === normalizeKey(batchNumber.trim()),
      );
      const nextBatch =
        inferredBatch ?? (batchNumber.trim() || expiresAt.trim() ? null : product.batches[0]);
      setSelectedBatchId(nextBatch?.id ?? null);
      if (nextBatch) {
        setBatchNumber(nextBatch.batchNumber ?? "");
        setExpiresAt(expiryInputValue(nextBatch.expiresAt));
      }
      setNotice(`${product.name} is ready. Update quantity or scan batch details next.`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setSavingProduct(false);
    }
  };

  const selectBatch = (batchId: string | null) => {
    setSelectedBatchId(batchId);
    const batch = activeProduct?.batches.find((candidate) => candidate.id === batchId);
    setBatchNumber(batch?.batchNumber ?? "");
    setExpiresAt(expiryInputValue(batch?.expiresAt ?? null));
    setBatchInference(null);
    if (batchId === null) setNewBatchId(createInventoryEntityId());
  };

  const confirmBatchDetails = async () => {
    if (!activeProduct) return;
    const expiry = expiresAt.trim() ? expiryTimestamp(expiresAt) : null;
    if (expiresAt.trim() && expiry === null) {
      setError("Use YYYY-MM-DD, YYYY-MM, DD-MM-YYYY, or MM/YY for the expiry.");
      return;
    }

    setSavingBatch(true);
    setError(null);
    setNotice(null);
    try {
      const batch = await saveBatchDetails({
        productId: activeProduct.id,
        ...(selectedBatchId ? { batchId: selectedBatchId } : { batchId: null, newBatchId }),
        batchNumber: batchNumber.trim() || null,
        expiresAt: expiry,
      });
      setSelectedBatchId(batch.id);
      setBatchInference(null);
      setMode("product");
      setCameraResetKey((current) => current + 1);
      setNotice("Batch number and expiry updated.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setSavingBatch(false);
    }
  };

  const confirmQuantity = async (quantities: { packQuantity: number; unitQuantity: number }) => {
    if (!activeProduct) return;
    const isNewBatch = selectedBatchId === null;
    const expiry = expiresAt.trim() ? expiryTimestamp(expiresAt) : null;
    if (isNewBatch && expiresAt.trim() && expiry === null) {
      setError("Use YYYY-MM-DD, YYYY-MM, DD-MM-YYYY, or MM/YY for the expiry.");
      return;
    }
    setSavingQuantity(true);
    setError(null);
    setNotice(null);
    try {
      const batchTarget = selectedBatchId
        ? { batchId: selectedBatchId }
        : { batchId: null, newBatchId };
      const quantityDetails = {
        productId: activeProduct.id,
        ...batchTarget,
        ...quantities,
      };
      const batch = await updateBatchQuantity(
        isNewBatch
          ? {
              ...quantityDetails,
              batchNumber: batchNumber.trim() || null,
              expiresAt: expiry,
            }
          : quantityDetails,
      );
      setSelectedBatchId(batch.id);
      setQuantityOpen(false);
      setNotice("Quantity updated and recorded as a stock adjustment.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setSavingQuantity(false);
    }
  };

  return (
    <>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: background }}
      >
        <View style={styles.intro}>
          <Text style={[styles.sectionTitle, { color: foreground }]}>
            {mode === "product" ? "Scan the front label" : "Scan batch & expiry"}
          </Text>
          <Text style={[styles.caption, { color: muted }]}>
            {mode === "product"
              ? "Text is read privately on this phone, then structured into editable product fields."
              : "Turn the pack to the printed lot and expiry panel, then read it again."}
          </Text>
        </View>

        <InlineTextCamera
          mode={mode}
          onCaptureStateChange={onCaptureStateChange}
          onError={setError}
          onTextDetected={onTextDetected}
          resetKey={cameraResetKey}
          status={cameraStatus}
        />

        {error ? (
          <HeroAlert status="danger">
            <HeroAlert.Indicator />
            <HeroAlert.Content>
              <HeroAlert.Title>Needs attention</HeroAlert.Title>
              <HeroAlert.Description>{error}</HeroAlert.Description>
            </HeroAlert.Content>
          </HeroAlert>
        ) : null}

        {notice ? (
          <HeroAlert status="success">
            <HeroAlert.Indicator />
            <HeroAlert.Content>
              <HeroAlert.Title>Saved</HeroAlert.Title>
              <HeroAlert.Description>{notice}</HeroAlert.Description>
            </HeroAlert.Content>
          </HeroAlert>
        ) : null}

        {productInference ? (
          <Card variant="default">
            <Card.Header style={styles.reviewHeader}>
              <View style={styles.headerCopy}>
                <Card.Title>Review product</Card.Title>
                <Card.Description>Everything stays editable before it is saved.</Card.Description>
              </View>
              <View style={styles.source}>
                <Badge tone={productInference.source === "cloud" ? "default" : "warning"}>
                  {sourceLabel}
                </Badge>
                <Text style={[styles.caption, { color: muted }]}>{confidence}</Text>
              </View>
            </Card.Header>
            <Card.Body style={styles.cardBody}>
              <View style={[styles.match, { backgroundColor: subtle }]}>
                <View style={styles.matchCopy}>
                  <Text style={[styles.captionMedium, { color: foreground }]}>
                    {matchedProduct ? "Existing product matched" : "New product"}
                  </Text>
                  <Text style={[styles.caption, { color: muted }]} numberOfLines={1}>
                    {matchedProduct
                      ? [matchedProduct.name, matchedProduct.details || matchedProduct.category]
                          .filter(Boolean)
                          .join(" · ")
                      : "A new inventory record will be created"}
                  </Text>
                </View>
                {matchedProduct ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      setMatchedProductId(null);
                      setSavedProductId(null);
                      setCategoryId(categories[0]?.id ?? "");
                      setNewProductId(createInventoryEntityId());
                    }}
                  >
                    Create new
                  </Button>
                ) : null}
              </View>

              <TextField isRequired>
                <Label>Product name</Label>
                <Input onChangeText={setName} placeholder="Product name" value={name} />
              </TextField>
              <TextField>
                <Label>Composition</Label>
                <Input
                  multiline
                  numberOfLines={2}
                  onChangeText={setComposition}
                  placeholder="Active ingredient"
                  value={composition}
                />
              </TextField>

              {!matchedProduct && selectedCategory?.tracksPacks !== false ? (
                <TextField isRequired>
                  <Label>Units per sealed pack</Label>
                  <Input
                    keyboardType="number-pad"
                    onChangeText={setUnitsPerPack}
                    placeholder="e.g. 10"
                    value={unitsPerPack}
                  />
                </TextField>
              ) : null}
              <TextField>
                <Label>Strength</Label>
                <Input onChangeText={setStrength} placeholder="e.g. 500mg" value={strength} />
              </TextField>

              {!matchedProduct ? (
                <View style={styles.fieldGroup}>
                  <Text style={[styles.captionMedium, { color: foreground }]}>Category</Text>
                  {categories.length > 0 ? (
                    <View style={styles.chips}>
                      {categories.map((category) => (
                        <ChoiceChip
                          key={category.id}
                          onPress={() => setCategoryId(category.id)}
                          selected={categoryId === category.id}
                        >
                          {category.name}
                        </ChoiceChip>
                      ))}
                    </View>
                  ) : (
                    <Text style={[styles.caption, { color: muted }]}>
                      A General category will be created with this first product.
                    </Text>
                  )}
                </View>
              ) : null}
            </Card.Body>
            <Card.Footer>
              <Button
                isDisabled={cameraBusy || savingProduct}
                onPress={() => void confirmProduct()}
              >
                {savingProduct
                  ? "Saving product…"
                  : matchedProduct
                    ? "Confirm product"
                    : "Create product"}
              </Button>
            </Card.Footer>
          </Card>
        ) : (
          <Card variant="secondary">
            <Card.Body style={styles.guidance}>
              <Text style={[styles.bodyMedium, { color: foreground }]}>
                One clear photo is enough
              </Text>
              <Text style={[styles.caption, { color: muted }]}>
                Avoid glare, keep the printed name sharp, and include the ingredient or composition
                line when possible.
              </Text>
            </Card.Body>
          </Card>
        )}

        {activeProduct && savedProductId ? (
          <Card variant="secondary">
            <Card.Header>
              <Card.Title>Inventory details</Card.Title>
              <Card.Description>
                Batch details and quantity are deliberately separate actions.
              </Card.Description>
            </Card.Header>
            <Card.Body style={styles.cardBody}>
              {activeProduct.batches.length > 0 ? (
                <View style={styles.fieldGroup}>
                  <Text style={[styles.captionMedium, { color: foreground }]}>Target batch</Text>
                  <View style={styles.chips}>
                    {activeProduct.batches.map((batch, index) => (
                      <ChoiceChip
                        key={batch.id}
                        onPress={() => selectBatch(batch.id)}
                        selected={selectedBatchId === batch.id}
                      >
                        {batch.batchNumber || `Batch ${index + 1}`}
                      </ChoiceChip>
                    ))}
                    <ChoiceChip
                      onPress={() => selectBatch(null)}
                      selected={selectedBatchId === null}
                    >
                      New batch
                    </ChoiceChip>
                  </View>
                </View>
              ) : null}

              <View style={styles.actions}>
                <Button
                  isDisabled={cameraBusy}
                  variant="secondary"
                  onPress={() => resetCamera("batch")}
                >
                  Scan batch & expiry
                </Button>
                <Button
                  variant="outline"
                  isDisabled={cameraBusy}
                  onPress={() => {
                    setError(null);
                    setNotice(null);
                    setQuantityOpen(true);
                  }}
                >
                  Update quantity
                </Button>
              </View>
            </Card.Body>
          </Card>
        ) : null}

        {mode === "batch" && activeProduct && batchInference ? (
          <Card variant="default">
            <Card.Header style={styles.reviewHeader}>
              <View style={styles.headerCopy}>
                <Card.Title>Review batch details</Card.Title>
                <Card.Description>{activeProduct.name}</Card.Description>
              </View>
              <Badge tone={batchInference.source === "cloud" ? "default" : "warning"}>
                {batchInference.source === "cloud" ? "AI structured" : "On-device result"}
              </Badge>
            </Card.Header>
            <Card.Body style={styles.cardBody}>
              <TextField>
                <Label>Batch / lot number</Label>
                <Input
                  autoCapitalize="characters"
                  onChangeText={setBatchNumber}
                  placeholder="e.g. BN-2048"
                  value={batchNumber}
                />
              </TextField>
              <TextField>
                <Label>Expiry</Label>
                <Input
                  autoCapitalize="none"
                  onChangeText={setExpiresAt}
                  placeholder="YYYY-MM-DD or YYYY-MM"
                  value={expiresAt}
                />
              </TextField>
            </Card.Body>
            <Card.Footer style={styles.footerActions}>
              <Button
                style={styles.flex}
                isDisabled={cameraBusy || savingBatch}
                onPress={() => void confirmBatchDetails()}
              >
                {savingBatch ? "Saving…" : "Save details"}
              </Button>
              <Button
                style={styles.flex}
                isDisabled={cameraBusy || savingBatch}
                variant="ghost"
                onPress={() => resetCamera("batch")}
              >
                Scan again
              </Button>
            </Card.Footer>
          </Card>
        ) : null}

        {activeProduct && savedProductId ? (
          <Button variant="ghost" onPress={() => router.back()}>
            Done
          </Button>
        ) : null}
      </ScrollView>

      {activeProduct?.tracksPacks ? (
        <PackQuantitySheet
          initialPackQuantity={selectedBatch?.packQuantity ?? 0}
          initialUnitQuantity={selectedBatch?.unitQuantity ?? 0}
          isNewBatch={selectedBatchId === null}
          onClose={() => setQuantityOpen(false)}
          onSave={confirmQuantity}
          productName={activeProduct.name}
          saveError={error}
          saving={savingQuantity}
          visible={quantityOpen}
        />
      ) : activeProduct ? (
        <UnitQuantitySheet
          initialPackQuantity={selectedBatch?.packQuantity ?? 0}
          initialUnitQuantity={selectedBatch?.unitQuantity ?? 0}
          isNewBatch={selectedBatchId === null}
          onClose={() => setQuantityOpen(false)}
          onSave={confirmQuantity}
          productName={activeProduct.name}
          saveError={error}
          saving={savingQuantity}
          visible={quantityOpen}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 12 },
  bodyMedium: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 20 },
  captionMedium: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 18 },
  cardBody: { gap: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  content: { gap: 20, paddingBottom: 48, paddingHorizontal: 16, paddingTop: 12 },
  fieldGroup: { gap: 8 },
  flex: { flex: 1 },
  footerActions: { gap: 12 },
  guidance: { gap: 4 },
  headerCopy: { flex: 1, gap: 4, minWidth: 0 },
  intro: { gap: 4 },
  match: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 10,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  matchCopy: { flex: 1, gap: 2, minWidth: 0 },
  reviewHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  sectionTitle: { fontFamily: "Inter_500Medium", fontSize: 16, lineHeight: 22 },
  source: { alignItems: "flex-end", gap: 6 },
});
