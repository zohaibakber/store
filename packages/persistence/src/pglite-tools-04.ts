import type { PGlite } from "pglite-04";

declare module "pglite-tools-04/pg_dump" {
  export function pgDump(options: {
    readonly pg: PGlite;
    readonly args?: Array<string>;
    readonly database?: string;
    readonly fileName?: string;
    readonly verbose?: boolean;
  }): Promise<File>;
}
