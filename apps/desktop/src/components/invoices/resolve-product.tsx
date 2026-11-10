import type { Product, ProductId } from "@store/contracts";
import { Suspense, useEffect, useRef } from "react";

import { useSuspenseCatalogProduct } from "@/inventory/queries";

function Resolve({
  productId,
  onResolve,
}: {
  readonly productId: ProductId;
  readonly onResolve: (product: Product | undefined) => void;
}) {
  const product = useSuspenseCatalogProduct(productId);
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    onResolve(product);
  }, [onResolve, product]);

  return null;
}

function ProductResolver(props: {
  readonly productId: ProductId;
  readonly onResolve: (product: Product | undefined) => void;
}) {
  return (
    <Suspense fallback={null}>
      <Resolve {...props} />
    </Suspense>
  );
}

export { ProductResolver };
