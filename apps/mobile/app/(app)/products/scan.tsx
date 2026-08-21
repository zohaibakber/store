import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonIcon, ButtonText } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { FullscreenTextCamera } from "@/features/product-scanner/fullscreen-text-camera";
import { expiryInputValue, expiryTimestamp } from "@/features/product-scanner/local-parser";
import { findProductMatch } from "@/features/product-scanner/product-match";
import { PackQuantitySheet, UnitQuantitySheet } from "@/features/product-scanner/quantity-sheet";
import { inferProductFromImage } from "@/features/product-scanner/scan-api";
import type { ProductScanInference, ProductScanMode } from "@/features/product-scanner/types";
import {
  productStatusView,
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import { authErrorMessage } from "@/lib/auth-client";
import { hapticSuccess } from "@/lib/haptics";
import { createInventoryEntityId } from "@/lib/products";
import { useColors } from "@/theme/colors";
import { radius } from "@/theme/tokens";

const normalizeKey = (value: string | null) => value?.trim().toLocaleLowerCase() ?? "";

export default function ProductScanScreen() {
  const { products, categories } = useProductData();
  const { loading } = productStatusView(useProductStatus());
  const { saveScannedProduct, saveBatchDetails, updateBatchQuantity } = useProductActions();
  const colors = useColors();
  const insets = useSafeAreaInsets();
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
  const reviewOpen = Boolean(
    productInference || (mode === "batch" && batchInference) || (activeProduct && savedProductId),
  );
  const cameraActive = screenFocused && appActive && !quantityOpen;
  const cameraStatus = !cameraActive
    ? "paused"
    : loading
      ? "syncing"
      : analyzing
        ? "analyzing"
        : "ready";

  const resetCamera = (nextMode: ProductScanMode) => {
    setMode(nextMode);
    setCameraResetKey((current) => current + 1);
    if (nextMode === "batch") setBatchInference(null);
    if (nextMode === "product") {
      setProductInference(null);
      setSavedProductId(null);
    }
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

  const onImageCaptured = async (imageUri: string) => {
    setAnalyzing(true);
    setError(null);
    setNotice(null);
    try {
      const inference = await inferProductFromImage(imageUri, mode);
      if (mode === "batch") {
        applyBatchInference(inference);
        return;
      }

      const match = findProductMatch(products, inference, [
        inference.name,
        inference.composition,
        inference.strength,
      ]
        .filter(Boolean)
        .join("\n"));
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
      setNotice(`${product.name} is saved. Set the quantity, or scan its batch panel next.`);
      hapticSuccess();
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
      hapticSuccess();
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
      hapticSuccess();
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setSavingQuantity(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.viewfinder }]}>
      <FullscreenTextCamera
        mode={mode}
        onCaptureStateChange={onCaptureStateChange}
        onClose={() => router.back()}
        onError={setError}
        onImageCaptured={onImageCaptured}
        resetKey={cameraResetKey}
        status={cameraStatus}
      />

      {error && !reviewOpen ? (
        <View style={[styles.floatingAlert, { bottom: insets.bottom + 110 }]}>
          <Alert variant="destructive">
            <AlertTitle>Needs attention</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </View>
      ) : null}

      {reviewOpen ? (
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
          <ScrollView
            ref={scroll}
            contentContainerStyle={[
              styles.content,
              { paddingBottom: Math.max(insets.bottom, 16) + 24 },
            ]}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            style={styles.sheetScroll}
          >
            <View style={styles.intro}>
              <Text variant="subheading">
                {mode === "batch" ? "Review batch" : productInference ? "Review product" : "Inventory"}
              </Text>
              <Text tone="muted" variant="caption">
                {mode === "batch"
                  ? "Confirm the lot and expiry, then save."
                  : "Everything stays editable until you save."}
              </Text>
            </View>

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Needs attention</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {notice ? (
              <Alert variant="success">
                <AlertTitle>Saved</AlertTitle>
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            ) : null}

            {productInference ? (
              <Card>
                <CardHeader style={styles.reviewHeader}>
                  <View style={styles.headerCopy}>
                    <CardTitle>Product</CardTitle>
                    <CardDescription>Edit anything that looks off.</CardDescription>
                  </View>
                  <Badge variant={productInference.source === "cloud" ? "secondary" : "warning"}>
                    {productInference.source === "cloud" ? "AI" : "On device"}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <View style={[styles.match, { backgroundColor: colors.secondary }]}>
                    <View style={styles.matchCopy}>
                      <Text variant="label">
                        {matchedProduct ? "Matched an existing product" : "New product"}
                      </Text>
                      <Text numberOfLines={1} tone="muted" variant="caption">
                        {matchedProduct
                          ? [matchedProduct.name, matchedProduct.details || matchedProduct.category]
                              .filter(Boolean)
                              .join(" · ")
                          : "A new inventory record will be created"}
                      </Text>
                    </View>
                    {matchedProduct ? (
                      <Button
                        onPress={() => {
                          setMatchedProductId(null);
                          setSavedProductId(null);
                          setCategoryId(categories[0]?.id ?? "");
                          setNewProductId(createInventoryEntityId());
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <ButtonText>Create new</ButtonText>
                      </Button>
                    ) : null}
                  </View>

                  <Field>
                    <FieldLabel>Product name</FieldLabel>
                    <Input onChangeText={setName} placeholder="Product name" value={name} />
                  </Field>
                  <Field>
                    <FieldLabel>Composition</FieldLabel>
                    <Input
                      multiline
                      numberOfLines={2}
                      onChangeText={setComposition}
                      placeholder="Active ingredient"
                      value={composition}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Strength</FieldLabel>
                    <Input onChangeText={setStrength} placeholder="e.g. 500mg" value={strength} />
                  </Field>

                  {!matchedProduct && selectedCategory?.tracksPacks !== false ? (
                    <Field>
                      <FieldLabel>Units per sealed pack</FieldLabel>
                      <Input
                        keyboardType="number-pad"
                        mono
                        onChangeText={setUnitsPerPack}
                        placeholder="10"
                        value={unitsPerPack}
                      />
                    </Field>
                  ) : null}

                  {!matchedProduct ? (
                    <Field>
                      <FieldLabel>Category</FieldLabel>
                      {categories.length > 0 ? (
                        <View style={styles.chips}>
                          {categories.map((category) => (
                            <Chip
                              key={category.id}
                              isSelected={categoryId === category.id}
                              onPress={() => setCategoryId(category.id)}
                            >
                              {category.name}
                            </Chip>
                          ))}
                        </View>
                      ) : (
                        <FieldDescription>
                          A General category is created with this first product.
                        </FieldDescription>
                      )}
                    </Field>
                  ) : null}
                </CardContent>
                <CardFooter style={styles.rowActions}>
                  <Button
                    isDisabled={cameraBusy || savingProduct}
                    loading={savingProduct}
                    onPress={() => void confirmProduct()}
                    style={styles.flex}
                  >
                    <ButtonText>
                      {matchedProduct ? "Confirm product" : "Create product"}
                    </ButtonText>
                  </Button>
                  <Button
                    isDisabled={cameraBusy || savingProduct}
                    onPress={() => resetCamera("product")}
                    style={styles.flex}
                    variant="ghost"
                  >
                    <ButtonText>Scan again</ButtonText>
                  </Button>
                </CardFooter>
              </Card>
            ) : null}

            {activeProduct && savedProductId ? (
              <Card>
                <CardHeader>
                  <CardTitle>Inventory</CardTitle>
                  <CardDescription>Batch details and quantity are separate steps.</CardDescription>
                </CardHeader>
                <CardContent>
                  {activeProduct.batches.length > 0 ? (
                    <Field>
                      <FieldLabel>Target batch</FieldLabel>
                      <View style={styles.chips}>
                        {activeProduct.batches.map((batch, index) => (
                          <Chip
                            key={batch.id}
                            isSelected={selectedBatchId === batch.id}
                            onPress={() => selectBatch(batch.id)}
                          >
                            {batch.batchNumber || `Batch ${index + 1}`}
                          </Chip>
                        ))}
                        <Chip isSelected={selectedBatchId === null} onPress={() => selectBatch(null)}>
                          New batch
                        </Chip>
                      </View>
                    </Field>
                  ) : null}
                </CardContent>
                <CardFooter style={styles.rowActions}>
                  <Button
                    isDisabled={cameraBusy}
                    onPress={() => {
                      setError(null);
                      setNotice(null);
                      setQuantityOpen(true);
                    }}
                    style={styles.flex}
                  >
                    <ButtonText>Set quantity</ButtonText>
                  </Button>
                  <Button
                    isDisabled={cameraBusy}
                    onPress={() => resetCamera("batch")}
                    style={styles.flex}
                    variant="outline"
                  >
                    <ButtonIcon name="camera" />
                    <ButtonText>Scan batch</ButtonText>
                  </Button>
                </CardFooter>
              </Card>
            ) : null}

            {mode === "batch" && activeProduct && batchInference ? (
              <Card>
                <CardHeader style={styles.reviewHeader}>
                  <View style={styles.headerCopy}>
                    <CardTitle>Batch</CardTitle>
                    <CardDescription>{activeProduct.name}</CardDescription>
                  </View>
                  <Badge variant={batchInference.source === "cloud" ? "secondary" : "warning"}>
                    {batchInference.source === "cloud" ? "AI" : "On device"}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <Field>
                    <FieldLabel>Batch or lot number</FieldLabel>
                    <Input
                      autoCapitalize="characters"
                      mono
                      onChangeText={setBatchNumber}
                      placeholder="BN-2048"
                      value={batchNumber}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Expiry</FieldLabel>
                    <Input
                      autoCapitalize="none"
                      mono
                      onChangeText={setExpiresAt}
                      placeholder="YYYY-MM-DD"
                      value={expiresAt}
                    />
                  </Field>
                </CardContent>
                <CardFooter style={styles.rowActions}>
                  <Button
                    isDisabled={cameraBusy || savingBatch}
                    loading={savingBatch}
                    onPress={() => void confirmBatchDetails()}
                    style={styles.flex}
                  >
                    <ButtonText>Save batch</ButtonText>
                  </Button>
                  <Button
                    isDisabled={cameraBusy || savingBatch}
                    onPress={() => resetCamera("batch")}
                    style={styles.flex}
                    variant="ghost"
                  >
                    <ButtonText>Scan again</ButtonText>
                  </Button>
                </CardFooter>
              </Card>
            ) : null}

            {activeProduct && savedProductId ? (
              <Button onPress={() => router.replace(`/products/${savedProductId}`)} variant="ghost">
                <ButtonText>Done</ButtonText>
              </Button>
            ) : null}
          </ScrollView>
        </View>
      ) : null}

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
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  content: { gap: 16, paddingHorizontal: 16, paddingTop: 4 },
  flex: { flex: 1 },
  floatingAlert: {
    left: 16,
    position: "absolute",
    right: 16,
  },
  headerCopy: { flex: 1, gap: 4, minWidth: 0 },
  intro: { gap: 4 },
  match: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radius.lg,
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
  root: { flex: 1 },
  rowActions: { flexDirection: "row" },
  sheet: {
    borderCurve: "continuous",
    borderTopLeftRadius: radius["2xl"],
    borderTopRightRadius: radius["2xl"],
    bottom: 0,
    left: 0,
    maxHeight: "72%",
    position: "absolute",
    right: 0,
  },
  sheetHandle: {
    alignSelf: "center",
    borderRadius: radius.full,
    height: 4,
    marginBottom: 8,
    marginTop: 10,
    width: 36,
  },
  sheetScroll: { flexGrow: 0 },
});
