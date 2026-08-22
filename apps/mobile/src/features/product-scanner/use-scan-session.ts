import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type ScrollView } from "react-native";

import { inferProductFromImage } from "@/features/product-scanner/firebase-scan";
import { expiryInputValue, expiryTimestamp } from "@/features/product-scanner/local-parser";
import { findProductMatch } from "@/features/product-scanner/product-match";
import type { ProductReviewDraft } from "@/features/product-scanner/review-product-card";
import {
  idlePhase,
  scanCameraBusy,
  scanCameraStatus,
  scanCaptureMode,
  scanReviewOpen,
  scanSheetTitle,
  withActivity,
  type ScanPending,
  type ScanPhase,
} from "@/features/product-scanner/scan-phase";
import type { ProductScanInference } from "@/features/product-scanner/types";
import {
  productStatusView,
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import { useBatchWrites, type QuantityInput } from "@/features/products/use-batch-writes";
import { authErrorMessage } from "@/lib/auth-client";
import { hapticSuccess } from "@/lib/haptics";
import { createInventoryEntityId } from "@/lib/inventory-session";

const normalizeKey = (value: string | null) => value?.trim().toLocaleLowerCase() ?? "";

const emptyDraft = (): ProductReviewDraft => ({
  name: "",
  composition: "",
  strength: "",
  unitsPerPack: "1",
  categoryId: "",
});

export function useScanSession() {
  const { products, categories } = useProductData();
  const { loading } = productStatusView(useProductStatus());
  const { saveScannedProduct } = useProductActions();
  const { pending: batchPending, writeBatchDetails, writeBatchQuantity } = useBatchWrites();

  const scroll = useRef<ScrollView>(null);
  const [phase, setPhase] = useState<ScanPhase>(idlePhase);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [productPending, setProductPending] = useState(false);
  const [screenFocused, setScreenFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [quantityOpen, setQuantityOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductReviewDraft>(emptyDraft);
  const [batchNumber, setBatchNumber] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [newProductId, setNewProductId] = useState(createInventoryEntityId);
  const [newBatchId, setNewBatchId] = useState(createInventoryEntityId);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

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

  const pending: ScanPending = productPending ? "product" : batchPending;
  const captureMode = scanCaptureMode(phase);
  const reviewOpen = scanReviewOpen(phase);
  const cameraBusy = scanCameraBusy(phase);
  const sheetCopy = scanSheetTitle(phase);
  const cameraActive = screenFocused && appActive && !quantityOpen;
  const cameraStatus = scanCameraStatus(phase, { cameraActive, syncing: loading });

  const matchedProductId = phase.type === "reviewProduct" ? phase.matchedProductId : null;
  const savedProductId = phase.type === "inventoryReady" ? phase.productId : null;
  const productInference = phase.type === "reviewProduct" ? phase.inference : null;
  const batchInference =
    phase.type === "inventoryReady" && phase.batchScan?.type === "reviewBatch"
      ? phase.batchScan.inference
      : null;

  const matchedProduct = products.find((product) => product.id === matchedProductId) ?? null;
  const activeProduct =
    products.find((product) => product.id === (savedProductId ?? matchedProductId)) ?? null;
  const selectedBatch =
    activeProduct?.batches.find((batch) => batch.id === selectedBatchId) ?? null;
  const selectedCategory = categories.find((category) => category.id === draft.categoryId) ?? null;

  const bumpCamera = () => setCameraResetKey((current) => current + 1);

  const resetToProductScan = () => {
    setPhase(idlePhase());
    bumpCamera();
    setError(null);
    setNotice(null);
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  const resetToBatchScan = (productId: string) => {
    setPhase({
      type: "inventoryReady",
      productId,
      batchScan: { type: "scanning", activity: "ready" },
    });
    bumpCamera();
    setError(null);
    setNotice(null);
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  const applyBatchInference = (
    productId: string,
    inference: ProductScanInference,
    product = products.find((candidate) => candidate.id === productId) ?? null,
  ) => {
    const matchingBatch = product?.batches.find(
      (batch) =>
        inference.batchNumber &&
        normalizeKey(batch.batchNumber) === normalizeKey(inference.batchNumber),
    );
    const fallbackBatch = matchingBatch ?? (!inference.batchNumber ? selectedBatch : null);
    setBatchNumber(inference.batchNumber ?? fallbackBatch?.batchNumber ?? "");
    setExpiresAt(inference.expiresAt ?? expiryInputValue(fallbackBatch?.expiresAt ?? null));
    if (matchingBatch) setSelectedBatchId(matchingBatch.id);
    else if (inference.batchNumber) {
      setSelectedBatchId(null);
      setNewBatchId(createInventoryEntityId());
    }
    setPhase({
      type: "inventoryReady",
      productId,
      batchScan: { type: "reviewBatch", inference },
    });
  };

  const onCaptureStateChange = (capturing: boolean) => {
    if (!capturing) {
      setPhase((current) => withActivity(current, "ready"));
      return;
    }
    setError(null);
    setNotice(null);
    const batchScanning = phase.type === "inventoryReady" && phase.batchScan;
    if (batchScanning) {
      setNewBatchId(createInventoryEntityId());
      setPhase({
        type: "inventoryReady",
        productId: phase.productId,
        batchScan: { type: "scanning", activity: "capturing" },
      });
      return;
    }
    setSelectedBatchId(null);
    setNewProductId(createInventoryEntityId());
    setNewBatchId(createInventoryEntityId());
    setPhase(idlePhase("capturing"));
  };

  const onImageCaptured = async (imageUri: string) => {
    const mode = scanCaptureMode(phase);
    const inventoryProductId = phase.type === "inventoryReady" ? phase.productId : null;
    setPhase((current) => withActivity(current, "analyzing"));
    setError(null);
    setNotice(null);
    try {
      const inference = await inferProductFromImage(imageUri, mode);
      if (mode === "batch" && inventoryProductId) {
        applyBatchInference(inventoryProductId, inference);
        return;
      }

      const match = findProductMatch(
        products,
        inference,
        [inference.name, inference.composition, inference.strength].filter(Boolean).join("\n"),
      );
      setDraft({
        name: inference.name ?? match?.name ?? "",
        composition: inference.composition ?? match?.composition ?? "",
        strength: inference.strength ?? match?.strength ?? "",
        unitsPerPack: String(inference.unitsPerPack ?? match?.unitsPerPack ?? 1),
        categoryId: match?.categoryId ?? categories[0]?.id ?? "",
      });
      setBatchNumber(inference.batchNumber ?? "");
      setExpiresAt(inference.expiresAt ?? "");
      setSelectedBatchId(null);
      setPhase({
        type: "reviewProduct",
        inference,
        matchedProductId: match?.id ?? null,
      });
    } catch (cause) {
      setError(authErrorMessage(cause));
      setPhase((current) => withActivity(current, "ready"));
    }
  };

  const confirmProduct = async () => {
    if (phase.type !== "reviewProduct") return;
    if (!draft.name.trim()) {
      setError("Check the inferred product name before continuing.");
      return;
    }
    const parsedUnitsPerPack = Number(draft.unitsPerPack.trim());
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
    setProductPending(true);
    setError(null);
    setNotice(null);
    try {
      const productDetails = {
        name: draft.name,
        categoryId: matchedProduct?.categoryId ?? draft.categoryId,
        composition: draft.composition.trim() || null,
        strength: draft.strength.trim() || null,
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
      setPhase({ type: "inventoryReady", productId: product.id, batchScan: null });
      setNotice(`${product.name} is saved. Set the quantity, or scan its batch panel next.`);
      hapticSuccess();
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setProductPending(false);
    }
  };

  const selectBatch = (batchId: string | null) => {
    setSelectedBatchId(batchId);
    const batch = activeProduct?.batches.find((candidate) => candidate.id === batchId);
    setBatchNumber(batch?.batchNumber ?? "");
    setExpiresAt(expiryInputValue(batch?.expiresAt ?? null));
    if (phase.type === "inventoryReady" && phase.batchScan?.type === "reviewBatch") {
      setPhase({
        ...phase,
        batchScan: { type: "scanning", activity: "ready" },
      });
    }
    if (batchId === null) setNewBatchId(createInventoryEntityId());
  };

  const confirmBatchDetails = async () => {
    if (!activeProduct || phase.type !== "inventoryReady") return;
    const expiry = expiresAt.trim() ? expiryTimestamp(expiresAt) : null;
    if (expiresAt.trim() && expiry === null) {
      setError("Use YYYY-MM-DD, YYYY-MM, DD-MM-YYYY, or MM/YY for the expiry.");
      return;
    }

    setError(null);
    setNotice(null);
    const result = await writeBatchDetails({
      productId: activeProduct.id,
      selectedBatchId,
      newBatchId,
      batchNumber: batchNumber.trim() || null,
      expiresAt: expiry,
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSelectedBatchId(result.batch.id);
    setPhase({ type: "inventoryReady", productId: activeProduct.id, batchScan: null });
    bumpCamera();
    setNotice("Batch number and expiry updated.");
    hapticSuccess();
  };

  const confirmQuantity = async (quantities: { packQuantity: number; unitQuantity: number }) => {
    if (!activeProduct) return;
    const isNewBatch = selectedBatchId === null;
    const expiry = expiresAt.trim() ? expiryTimestamp(expiresAt) : null;
    if (isNewBatch && expiresAt.trim() && expiry === null) {
      setError("Use YYYY-MM-DD, YYYY-MM, DD-MM-YYYY, or MM/YY for the expiry.");
      return;
    }
    setError(null);
    setNotice(null);
    const quantityInput: QuantityInput = {
      productId: activeProduct.id,
      selectedBatchId,
      newBatchId,
      ...quantities,
    };
    if (isNewBatch) {
      quantityInput.batchNumber = batchNumber.trim() || null;
      quantityInput.expiresAt = expiry;
    }
    const result = await writeBatchQuantity(quantityInput);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSelectedBatchId(result.batch.id);
    setQuantityOpen(false);
    setNotice("Quantity updated and recorded as a stock adjustment.");
    hapticSuccess();
  };

  const patchDraft = (patch: Partial<ProductReviewDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const createNewInsteadOfMatch = () => {
    if (phase.type !== "reviewProduct") return;
    setPhase({ ...phase, matchedProductId: null });
    setDraft((current) => ({
      ...current,
      categoryId: categories[0]?.id ?? "",
    }));
    setNewProductId(createInventoryEntityId());
  };

  const openQuantity = () => {
    setError(null);
    setNotice(null);
    setQuantityOpen(true);
  };

  return {
    scroll,
    phase,
    cameraResetKey,
    captureMode,
    cameraStatus,
    cameraBusy,
    reviewOpen,
    sheetCopy,
    pending,
    quantityOpen,
    setQuantityOpen,
    error,
    notice,
    draft,
    batchNumber,
    expiresAt,
    selectedBatchId,
    productInference,
    batchInference,
    matchedProduct,
    activeProduct,
    selectedBatch,
    selectedCategory,
    categories,
    onCaptureStateChange,
    onImageCaptured,
    onError: setError,
    confirmProduct,
    confirmBatchDetails,
    confirmQuantity,
    selectBatch,
    patchDraft,
    createNewInsteadOfMatch,
    resetToProductScan,
    resetToBatchScan,
    openQuantity,
    setBatchNumber,
    setExpiresAt,
  };
}
