import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { Alert as HeroAlert } from "heroui-native/alert";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
import { TextField } from "heroui-native/text-field";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, ScrollView, Text, View } from "react-native";

import { InlineTextCamera } from "@/features/product-scanner/inline-text-camera";
import { expiryInputValue, expiryTimestamp } from "@/features/product-scanner/local-parser";
import { findProductMatch } from "@/features/product-scanner/product-match";
import { QuantitySheet } from "@/features/product-scanner/quantity-sheet";
import { inferProductText } from "@/features/product-scanner/scan-api";
import type { ProductScanInference, ProductScanMode } from "@/features/product-scanner/types";
import { useProducts } from "@/features/products/products-provider";
import { authErrorMessage } from "@/lib/auth-client";
import { createInventoryEntityId } from "@/lib/products";

const normalizeKey = (value: string | null) => value?.trim().toLocaleLowerCase() ?? "";

export default function ProductScanScreen() {
  const {
    products,
    categories,
    loading,
    saveScannedProduct,
    saveBatchDetails,
    updateBatchQuantity,
  } = useProducts();
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
      const product = await saveScannedProduct({
        ...(matchedProduct ? { productId: matchedProduct.id } : { productId: null, newProductId }),
        name,
        categoryId: matchedProduct?.categoryId ?? categoryId,
        composition: composition.trim() || null,
        strength: strength.trim() || null,
        ...(!matchedProduct ? { unitsPerPack: parsedUnitsPerPack } : {}),
      });
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
      const batch = await updateBatchQuantity({
        productId: activeProduct.id,
        ...(selectedBatchId ? { batchId: selectedBatchId } : { batchId: null, newBatchId }),
        ...quantities,
        ...(isNewBatch
          ? {
              batchNumber: batchNumber.trim() || null,
              expiresAt: expiry,
            }
          : {}),
      });
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
        className="bg-background"
        contentContainerClassName="gap-5 px-4 pb-12 pt-3"
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-1">
          <Text className="text-base font-medium text-foreground">
            {mode === "product" ? "Scan the front label" : "Scan batch & expiry"}
          </Text>
          <Text className="text-xs leading-5 font-normal text-muted">
            {mode === "product"
              ? "Text is read privately on this phone, then structured into editable product fields."
              : "Turn the pack to the printed lot and expiry panel, then read it again."}
          </Text>
        </View>

        <InlineTextCamera
          active={cameraActive}
          analyzing={analyzing}
          disabled={loading}
          mode={mode}
          onCaptureStateChange={onCaptureStateChange}
          onError={setError}
          onTextDetected={onTextDetected}
          resetKey={cameraResetKey}
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
            <Card.Header className="flex-row items-start justify-between gap-3 px-4 pt-4">
              <View className="min-w-0 flex-1 gap-1">
                <Card.Title>Review product</Card.Title>
                <Card.Description>Everything stays editable before it is saved.</Card.Description>
              </View>
              <View className="items-end gap-1.5">
                <Chip
                  color={productInference.source === "cloud" ? "accent" : "warning"}
                  size="sm"
                  variant="soft"
                >
                  {sourceLabel}
                </Chip>
                <Text className="text-xs font-normal text-muted">{confidence}</Text>
              </View>
            </Card.Header>
            <Card.Body className="gap-4 px-4 py-4">
              <View className="bg-surface-secondary flex-row items-center justify-between gap-3 rounded-2xl px-3 py-2.5">
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className="text-xs font-medium text-foreground">
                    {matchedProduct ? "Existing product matched" : "New product"}
                  </Text>
                  <Text className="text-xs font-normal text-muted" numberOfLines={1}>
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
                <View className="gap-2">
                  <Text className="text-xs font-medium text-foreground">Category</Text>
                  {categories.length > 0 ? (
                    <View className="flex-row flex-wrap gap-2">
                      {categories.map((category) => (
                        <Chip
                          key={category.id}
                          color={categoryId === category.id ? "accent" : "default"}
                          onPress={() => setCategoryId(category.id)}
                          size="sm"
                          variant="soft"
                        >
                          {category.name}
                        </Chip>
                      ))}
                    </View>
                  ) : (
                    <Text className="text-xs leading-5 font-normal text-muted">
                      A General category will be created with this first product.
                    </Text>
                  )}
                </View>
              ) : null}
            </Card.Body>
            <Card.Footer className="px-4 pb-4">
              <Button
                className="w-full"
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
            <Card.Body className="gap-1 px-4 py-4">
              <Text className="text-sm font-medium text-foreground">One clear photo is enough</Text>
              <Text className="text-xs leading-5 font-normal text-muted">
                Avoid glare, keep the printed name sharp, and include the ingredient or composition
                line when possible.
              </Text>
            </Card.Body>
          </Card>
        )}

        {activeProduct && savedProductId ? (
          <Card variant="secondary">
            <Card.Header className="px-4 pt-4">
              <Card.Title>Inventory details</Card.Title>
              <Card.Description>
                Batch details and quantity are deliberately separate actions.
              </Card.Description>
            </Card.Header>
            <Card.Body className="gap-4 px-4 py-4">
              {activeProduct.batches.length > 0 ? (
                <View className="gap-2">
                  <Text className="text-xs font-medium text-foreground">Target batch</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {activeProduct.batches.map((batch, index) => (
                      <Chip
                        key={batch.id}
                        color={selectedBatchId === batch.id ? "accent" : "default"}
                        onPress={() => selectBatch(batch.id)}
                        size="sm"
                        variant="soft"
                      >
                        {batch.batchNumber || `Batch ${index + 1}`}
                      </Chip>
                    ))}
                    <Chip
                      color={selectedBatchId === null ? "accent" : "default"}
                      onPress={() => selectBatch(null)}
                      size="sm"
                      variant="soft"
                    >
                      New batch
                    </Chip>
                  </View>
                </View>
              ) : null}

              <View className="gap-3">
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
            <Card.Header className="flex-row items-start justify-between gap-3 px-4 pt-4">
              <View className="min-w-0 flex-1 gap-1">
                <Card.Title>Review batch details</Card.Title>
                <Card.Description>{activeProduct.name}</Card.Description>
              </View>
              <Chip
                color={batchInference.source === "cloud" ? "accent" : "warning"}
                size="sm"
                variant="soft"
              >
                {batchInference.source === "cloud" ? "AI structured" : "On-device result"}
              </Chip>
            </Card.Header>
            <Card.Body className="gap-4 px-4 py-4">
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
            <Card.Footer className="gap-3 px-4 pb-4">
              <Button
                className="flex-1"
                isDisabled={cameraBusy || savingBatch}
                onPress={() => void confirmBatchDetails()}
              >
                {savingBatch ? "Saving…" : "Save details"}
              </Button>
              <Button
                className="flex-1"
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

      {activeProduct ? (
        <QuantitySheet
          initialPackQuantity={selectedBatch?.packQuantity ?? 0}
          initialUnitQuantity={selectedBatch?.unitQuantity ?? 0}
          isNewBatch={selectedBatchId === null}
          onClose={() => setQuantityOpen(false)}
          onSave={confirmQuantity}
          productName={activeProduct.name}
          saveError={error}
          saving={savingQuantity}
          tracksPacks={activeProduct.tracksPacks}
          visible={quantityOpen}
        />
      ) : null}
    </>
  );
}
