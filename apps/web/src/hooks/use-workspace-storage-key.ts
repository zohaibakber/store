import { useAuth } from "@/lib/auth";
import { workspaceStorageKey } from "@/lib/workspace";

export const useWorkspaceStorageKey = () => workspaceStorageKey(useAuth().workspace);
