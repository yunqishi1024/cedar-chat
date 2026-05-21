import { useCallback, useEffect, useRef } from "react";
import type { SyncSettings } from "./storage";
import type { CedarSyncSnapshot } from "./sync";
import { pullSyncSnapshot, pushSyncSnapshot } from "./sync";

export interface AutoSyncCallbacks {
  createSnapshot: () => CedarSyncSnapshot;
  mergeAndApply: (local: CedarSyncSnapshot, cloud: CedarSyncSnapshot) => CedarSyncSnapshot;
  applySnapshot: (snapshot: CedarSyncSnapshot) => void;
  onSyncComplete: (pushed: boolean, pulled: boolean) => void;
  onSyncError?: (error: Error) => void;
  onSyncStatus?: (message: string) => void;
  /** When true, skip sync to avoid interrupting AI streaming */
  isStreaming: () => boolean;
}

/**
 * Auto-sync hook: periodically pulls from cloud, merges, and pushes back.
 * Sync only fires when:
 *  - autoSyncEnabled is true
 *  - endpoint and syncCode are valid (syncCode >= 8 chars)
 *  - the tab is visible (document.visibilityState === "visible")
 *
 * Also syncs on:
 *  - visibility change (tab becomes visible again)
 *  - online event (network reconnects)
 */
export function useAutoSync(
  syncSettings: SyncSettings,
  callbacks: AutoSyncCallbacks,
): void {
  const busyRef = useRef(false);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const settingsRef = useRef(syncSettings);
  settingsRef.current = syncSettings;

  const doSync = useCallback(async () => {
    if (busyRef.current) return;
    if (!canSync()) return;
    if (callbacksRef.current.isStreaming()) return;

    busyRef.current = true;
    const { createSnapshot, mergeAndApply, applySnapshot, onSyncComplete, onSyncError, onSyncStatus } =
      callbacksRef.current;
    const settings = settingsRef.current;

    try {
      onSyncStatus?.("Auto-syncing...");
      const localSnapshot = createSnapshot();

      // 保护：本地没有对话时，只 pull 不 push（防止空数据覆盖云端）
      if (localSnapshot.conversations.length === 0 || 
          (localSnapshot.conversations.length === 1 && localSnapshot.conversations[0].messages.length === 0)) {
        const cloudSnapshot = await pullSyncSnapshot(settings);
        if (cloudSnapshot && cloudSnapshot.conversations.length > 0) {
          applySnapshot(cloudSnapshot);
        }
        onSyncComplete(false, Boolean(cloudSnapshot));
        onSyncStatus?.(null as unknown as string);
        return;
      }

      // Step 1: Pull first
      const cloudSnapshot = await pullSyncSnapshot(settings);

      // Step 2: Merge
      const mergedSnapshot = cloudSnapshot
        ? mergeAndApply(localSnapshot, cloudSnapshot)
        : localSnapshot;

      // Step 3: Apply only if cloud had extra content
      if (cloudSnapshot) {
        const localIds = localSnapshot.conversations.map(c => c.id).sort().join(",");
        const mergedIds = mergedSnapshot.conversations.map(c => c.id).sort().join(",");
        if (localIds !== mergedIds) {
          applySnapshot(mergedSnapshot);
        }
      }

      // Step 4: Push merged result
      await pushSyncSnapshot(settings, mergedSnapshot);
      onSyncComplete(true, Boolean(cloudSnapshot));
      onSyncStatus?.(null as unknown as string);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      onSyncError?.(err);
      onSyncStatus?.(`Auto-sync failed: ${err.message}`);
    } finally {
      busyRef.current = false;
    }
  }, [canSync]);
  
  // Periodic interval
  useEffect(() => {
    if (!syncSettings.autoSyncEnabled) return;
    if (!syncSettings.endpoint.trim() || syncSettings.syncCode.trim().length < 8) return;

    const intervalMs = syncSettings.autoSyncIntervalMs;

    // Run once immediately on enable
    const initialTimeout = setTimeout(() => {
      doSync();
    }, 2000);

    const intervalId = setInterval(() => {
      // Only sync when tab is visible to avoid unnecessary network requests
      if (document.visibilityState === "visible") {
        doSync();
      }
    }, intervalMs);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(intervalId);
    };
  }, [
    syncSettings.autoSyncEnabled,
    syncSettings.autoSyncIntervalMs,
    syncSettings.endpoint,
    syncSettings.syncCode,
    doSync,
  ]);

  // Sync when tab becomes visible again (user switches back)
  useEffect(() => {
    if (!syncSettings.autoSyncEnabled) return;

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        doSync();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [syncSettings.autoSyncEnabled, doSync]);

  // Sync when network comes back online
  useEffect(() => {
    if (!syncSettings.autoSyncEnabled) return;

    function handleOnline() {
      doSync();
    }

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [syncSettings.autoSyncEnabled, doSync]);
}
