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
  /** Return true if AI is currently streaming — sync will be skipped */
  isStreaming?: () => boolean;
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
    // Skip sync while AI is streaming to avoid interruption
    if (callbacksRef.current.isStreaming?.()) return;

    busyRef.current = true;
    const { createSnapshot, mergeAndApply, applySnapshot, onSyncComplete, onSyncError, onSyncStatus } =
      callbacksRef.current;
    const settings = settingsRef.current;

    try {
      onSyncStatus?.("Auto-syncing...");
      const localSnapshot = createSnapshot();

      // Guard: if local is empty (no real conversations), only pull — never push empty data
      const localIsEmpty =
        localSnapshot.conversations.length === 0 ||
        (localSnapshot.conversations.length === 1 &&
          localSnapshot.conversations[0].messages.length === 0);

      if (localIsEmpty) {
        const cloudSnapshot = await pullSyncSnapshot(settings);
        if (cloudSnapshot && cloudSnapshot.conversations.length > 0) {
          applySnapshot(cloudSnapshot);
        }
        onSyncComplete(false, Boolean(cloudSnapshot));
        onSyncStatus?.(null as unknown as string);
        return;
      }

      // Step 1: Pull from cloud first
      const cloudSnapshot = await pullSyncSnapshot(settings);

      // Step 2: Merge local + cloud
      const mergedSnapshot = cloudSnapshot
        ? mergeAndApply(localSnapshot, cloudSnapshot)
        : localSnapshot;

      // Step 3: Apply merged result if cloud contributed new content
      if (cloudSnapshot) {
        const localIds = localSnapshot.conversations.map(c => c.id).sort().join(",");
        const mergedIds = mergedSnapshot.conversations.map(c => c.id).sort().join(",");
        const localMsgCount = localSnapshot.conversations.reduce((n, c) => n + c.messages.length, 0);
        const mergedMsgCount = mergedSnapshot.conversations.reduce((n, c) => n + c.messages.length, 0);
        if (localIds !== mergedIds || localMsgCount !== mergedMsgCount) {
          applySnapshot(mergedSnapshot);
        }
      }

      // Step 4: Push merged result to cloud
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
