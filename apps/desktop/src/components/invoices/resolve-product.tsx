import type { Product } from "@store/contracts";
import { Suspense, useEffect, useRef } from "react";

import { useSuspenseCatalogProduct } from "@/lib/inventory";

function Resolve({
  productId,
  onResolve,
}: {
  readonly productId: string;
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
  readonly productId: string;
  readonly onResolve: (product: Product | undefined) => void;
}) {
  return (
    <Suspense fallback={null}>
      <Resolve {...props} />
    </Suspense>
  );
}

export { ProductResolver };
