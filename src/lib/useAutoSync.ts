import { useCallback, useEffect, useRef } from "react";
import type { SyncSettings } from "./storage";
import type { CedarSyncSnapshot } from "./sync";
import { pullSyncSnapshot, pushSyncSnapshot } from "./sync";

export interface AutoSyncCallbacks {
  /** Build the current local snapshot */
  createSnapshot: () => CedarSyncSnapshot;
  /** Merge remote into local and apply */
  mergeAndApply: (local: CedarSyncSnapshot, cloud: CedarSyncSnapshot) => CedarSyncSnapshot;
  /** Apply merged snapshot to app state */
  applySnapshot: (snapshot: CedarSyncSnapshot) => void;
  /** Update sync timestamps */
  onSyncComplete: (pushed: boolean, pulled: boolean) => void;
  /** Report errors (non-blocking) */
  onSyncError?: (error: Error) => void;
  /** Report status messages */
  onSyncStatus?: (message: string) => void;
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

  const canSync = useCallback((): boolean => {
    const s = settingsRef.current;
    return (
      s.autoSyncEnabled &&
      Boolean(s.endpoint.trim()) &&
      s.syncCode.trim().length >= 8
    );
  }, []);

  const doSync = useCallback(async () => {
    if (busyRef.current) return;
    if (!canSync()) return;

    busyRef.current = true;
    const { createSnapshot, mergeAndApply, applySnapshot, onSyncComplete, onSyncError, onSyncStatus } =
      callbacksRef.current;
    const settings = settingsRef.current;

    try {
      onSyncStatus?.("Auto-syncing...");
      const localSnapshot = createSnapshot();

      // Step 1: Upload local first (保证本地数据安全)
      await pushSyncSnapshot(settings, localSnapshot);

      // Step 2: Pull cloud and merge
      const cloudSnapshot = await pullSyncSnapshot(settings);
      if (cloudSnapshot) {
        const mergedSnapshot = mergeAndApply(localSnapshot, cloudSnapshot);

        // 只在有新内容时才 apply
        const localIds = localSnapshot.conversations.map(c => c.id).sort().join(",");
        const mergedIds = mergedSnapshot.conversations.map(c => c.id).sort().join(",");
        if (localIds !== mergedIds) {
          applySnapshot(mergedSnapshot);
          // Push merged result back
          await pushSyncSnapshot(settings, mergedSnapshot);
        }
      }

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
