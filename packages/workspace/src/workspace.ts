import type { TokenSet } from "@store/auth";
import type { WorkspaceSnapshot } from "@store/contracts";

export interface WorkspaceAuthAdapter {
  readonly snapshot: WorkspaceSnapshot;
  readonly initialize: () => Promise<WorkspaceSnapshot>;
  readonly adoptSession: (tokens: TokenSet | null) => Promise<WorkspaceSnapshot>;
  readonly renewSession: () => Promise<WorkspaceSnapshot>;
  readonly signOut: () => Promise<void>;
}
