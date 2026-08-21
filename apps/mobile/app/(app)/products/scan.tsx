import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, ButtonText } from "@/components/ui/button";
import { FullscreenTextCamera } from "@/features/product-scanner/fullscreen-text-camera";
import { InventoryReadyCard } from "@/features/product-scanner/inventory-ready-card";
import { PackQuantitySheet, UnitQuantitySheet } from "@/features/product-scanner/quantity-sheet";
import { ReviewBatchCard } from "@/features/product-scanner/review-batch-card";
import { ReviewProductCard } from "@/features/product-scanner/review-product-card";
import { ScanReviewSheet } from "@/features/product-scanner/scan-review-sheet";
import { useScanSession } from "@/features/product-scanner/use-scan-session";
import { useColors } from "@/theme/colors";

export default function ProductScanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const session = useScanSession();

  return (
    <View style={[styles.root, { backgroundColor: colors.viewfinder }]}>
      <FullscreenTextCamera
        mode={session.captureMode}
        onCaptureStateChange={session.onCaptureStateChange}
        onClose={() => router.back()}
        onError={session.onError}
        onImageCaptured={session.onImageCaptured}
        resetKey={session.cameraResetKey}
        status={session.cameraStatus}
      />

      {session.error && !session.reviewOpen ? (
        <View style={[styles.floatingAlert, { bottom: insets.bottom + 110 }]}>
          <Alert variant="destructive">
            <AlertTitle>Needs attention</AlertTitle>
            <AlertDescription>{session.error}</AlertDescription>
          </Alert>
        </View>
      ) : null}

      {session.reviewOpen ? (
        <ScanReviewSheet
          bottomInset={insets.bottom}
          error={session.error}
          notice={session.notice}
          scrollRef={session.scroll}
          subtitle={session.sheetCopy.subtitle}
          title={session.sheetCopy.title}
        >
          {session.productInference ? (
            <ReviewProductCard
              busy={session.cameraBusy}
              categories={session.categories}
              draft={session.draft}
              inference={session.productInference}
              matchedProduct={session.matchedProduct}
              onChangeDraft={session.patchDraft}
              onConfirm={() => void session.confirmProduct()}
              onCreateNew={session.createNewInsteadOfMatch}
              onScanAgain={session.resetToProductScan}
              saving={session.pending === "product"}
              selectedCategory={session.selectedCategory}
            />
          ) : null}

          {session.activeProduct && session.phase.type === "inventoryReady" ? (
            <InventoryReadyCard
              busy={session.cameraBusy}
              onScanBatch={() => session.resetToBatchScan(session.activeProduct!.id)}
              onSelectBatch={session.selectBatch}
              onSetQuantity={session.openQuantity}
              product={session.activeProduct}
              selectedBatchId={session.selectedBatchId}
            />
          ) : null}

          {session.batchInference && session.activeProduct ? (
            <ReviewBatchCard
              batchNumber={session.batchNumber}
              busy={session.cameraBusy}
              expiresAt={session.expiresAt}
              inference={session.batchInference}
              onChangeBatchNumber={session.setBatchNumber}
              onChangeExpiresAt={session.setExpiresAt}
              onConfirm={() => void session.confirmBatchDetails()}
              onScanAgain={() => session.resetToBatchScan(session.activeProduct!.id)}
              productName={session.activeProduct.name}
              saving={session.pending === "batch"}
            />
          ) : null}

          {session.phase.type === "inventoryReady" ? (
            <Button
              onPress={() => {
                if (session.phase.type !== "inventoryReady") return;
                router.replace(`/products/${session.phase.productId}`);
              }}
              variant="ghost"
            >
              <ButtonText>Done</ButtonText>
            </Button>
          ) : null}
        </ScanReviewSheet>
      ) : null}

      {session.activeProduct?.tracksPacks ? (
        <PackQuantitySheet
          initialPackQuantity={session.selectedBatch?.packQuantity ?? 0}
          initialUnitQuantity={session.selectedBatch?.unitQuantity ?? 0}
          isNewBatch={session.selectedBatchId === null}
          onClose={() => session.setQuantityOpen(false)}
          onSave={session.confirmQuantity}
          productName={session.activeProduct.name}
          saveError={session.error}
          saving={session.pending === "quantity"}
          visible={session.quantityOpen}
        />
      ) : session.activeProduct ? (
        <UnitQuantitySheet
          initialPackQuantity={session.selectedBatch?.packQuantity ?? 0}
          initialUnitQuantity={session.selectedBatch?.unitQuantity ?? 0}
          isNewBatch={session.selectedBatchId === null}
          onClose={() => session.setQuantityOpen(false)}
          onSave={session.confirmQuantity}
          productName={session.activeProduct.name}
          saveError={session.error}
          saving={session.pending === "quantity"}
          visible={session.quantityOpen}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  floatingAlert: {
    left: 16,
    position: "absolute",
    right: 16,
  },
  root: { flex: 1 },
});
