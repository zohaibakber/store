import { useEffect, useEffectEvent } from "react";

const lastPageIndex = (total: number, pageSize: number) =>
  Math.max(0, Math.ceil(total / Math.max(1, pageSize)) - 1);

export function usePageInRange(input: {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly settled: boolean;
  readonly onPageChange: (page: number) => void;
}) {
  const lastPage = lastPageIndex(input.total, input.pageSize);
  const beyond = input.settled && input.page > lastPage;
  const clamp = useEffectEvent(() => input.onPageChange(lastPage));
  useEffect(() => {
    if (beyond) clamp();
  }, [beyond, lastPage]);
}
