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

type BreadcrumbLabel = string | ((loaderData: unknown) => string);

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

          const label =
            typeof breadcrumb === "function" ? breadcrumb(match.loaderData) : breadcrumb;
          const isCurrent = index === breadcrumbMatches.length - 1;
          const to =
            match.fullPath === "/products/"
              ? "/products"
              : match.fullPath === "/invoices/"
                ? "/invoices"
                : match.fullPath;

          return (
            <Fragment key={match.id}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {isCurrent ? (
                  <BreadcrumbPage className="truncate">{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    className="truncate"
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
