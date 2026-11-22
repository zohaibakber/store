import type { Invoice } from "@store/contracts";
import { Link, useMatches } from "@tanstack/react-router";
import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

type BreadcrumbLoaderData = Invoice | { readonly product?: { readonly name: string } } | undefined;
type BreadcrumbParams = Readonly<Record<string, string | undefined>>;
type BreadcrumbResolver = (loaderData: BreadcrumbLoaderData, params: BreadcrumbParams) => string;
type BreadcrumbLabel = string | BreadcrumbResolver;

const isBreadcrumbLoader = <Value,>(value: Value): value is Value & BreadcrumbResolver =>
  typeof value === "function";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    breadcrumb?: BreadcrumbLabel;
  }
}

export function SiteBreadcrumbs() {
  const matches = useMatches();
  const breadcrumbMatches = matches.filter((match) => match.staticData.breadcrumb);

  return (
    <Breadcrumb className="min-w-0 overflow-hidden">
      <BreadcrumbList className="flex-nowrap">
        {breadcrumbMatches.map((match, index) => {
          const breadcrumb = match.staticData.breadcrumb;
          if (!breadcrumb) return null;

          let label: string;
          if (isBreadcrumbLoader(breadcrumb)) {
            // SAFETY: TanStack supplies each match's own loader result to its static-data label.
            const loaderData = match.loaderData as BreadcrumbLoaderData;
            label = breadcrumb(loaderData, match.params);
          } else {
            label = breadcrumb;
          }
          const isCurrent = index === breadcrumbMatches.length - 1;
          // Narrow windows keep only the current page and its parent.
          const isDistant = index < breadcrumbMatches.length - 2;
          const to =
            match.fullPath === "/products/"
              ? "/products"
              : match.fullPath === "/invoices/"
                ? "/invoices"
                : match.fullPath === "/purchases/"
                  ? "/purchases"
                  : match.fullPath === "/settings/"
                    ? "/settings"
                    : match.fullPath;

          return (
            <Fragment key={match.id}>
              {index > 0 && (
                <BreadcrumbSeparator
                  className={cn(
                    "shrink-0",
                    index < breadcrumbMatches.length - 1 && "max-lg:hidden",
                  )}
                />
              )}
              <BreadcrumbItem
                className={cn(
                  "min-w-0",
                  isCurrent ? "shrink" : "max-w-40 shrink-[2]",
                  isDistant && "max-lg:hidden",
                )}
              >
                {isCurrent ? (
                  <BreadcrumbPage className="min-w-0 truncate">{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    className="min-w-0 truncate"
                    render={<Link params={match.params} to={to} />}
                  >
                    {label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
