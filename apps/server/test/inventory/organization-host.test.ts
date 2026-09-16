import {
  InventoryImportId,
  InventoryReleaseId,
  OrganizationId,
  SyncProtocolError,
} from "@store/contracts";
import { LAST_UNIT_ORGANIZATION_ID } from "@store/contracts/sync/fixtures";
import { openInventoryStore, seedLastUnitCatalog } from "@store/sync/authority/store";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { verifyRoutingEvidence } from "../../src/inventory/organization-host";

const isProtocol = Schema.is(SyncProtocolError);

const release = (value: string) => Schema.decodeUnknownSync(InventoryReleaseId)(value);
const importId = (value: string) => Schema.decodeUnknownSync(InventoryImportId)(value);

describe("organization host identity", () => {
  it("rejects a routing context whose import or release identity does not match stored state", () => {
    const store = openInventoryStore();
    try {
      seedLastUnitCatalog(store.db);
      try {
        verifyRoutingEvidence(store.db, {
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          importId: importId("import-test"),
          releaseId: release("release-other"),
        });
        throw new Error("expected IMPORT_IDENTITY_MISMATCH");
      } catch (error) {
        expect(isProtocol(error)).toBe(true);
        if (isProtocol(error)) {
          expect(error.code).toBe("IMPORT_IDENTITY_MISMATCH");
        }
      }
      try {
        verifyRoutingEvidence(store.db, {
          organizationId: Schema.decodeUnknownSync(OrganizationId)("org-other"),
          importId: importId("import-test"),
          releaseId: release("release-test"),
        });
        throw new Error("expected IMPORT_IDENTITY_MISMATCH");
      } catch (error) {
        expect(isProtocol(error)).toBe(true);
        if (isProtocol(error)) {
          expect(error.code).toBe("IMPORT_IDENTITY_MISMATCH");
        }
      }
    } finally {
      store.close();
    }
  });

  it("accepts routing evidence that matches the stored ready identity", () => {
    const store = openInventoryStore();
    try {
      seedLastUnitCatalog(store.db);
      const identity = verifyRoutingEvidence(store.db, {
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        importId: importId("import-test"),
        releaseId: release("release-test"),
      });
      expect(identity).toEqual({
        _tag: "ready",
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        importId: importId("import-test"),
        releaseId: release("release-test"),
        epoch: "1",
      });
    } finally {
      store.close();
    }
  });
});
