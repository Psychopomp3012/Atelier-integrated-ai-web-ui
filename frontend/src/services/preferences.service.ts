/**
 * Unified Client Preferences Store
 *
 * Implements the 2-Store Hybrid Architecture:
 * - Decouples lightweight UI settings (model, effort, theme, active session ID) from heavy chat history.
 * - Stores all preferences as a single structured JSON object scoped by userId (`atelier_prefs_${userId}`).
 * - Provides 0ms instant synchronous hydration on page refresh without multiple uncoordinated reads.
 */

export interface UserWorkspacePreferences {
  theme?: 'dark' | 'light';
  selectedModelId?: string;
  selectedEffort?: string;
  activeSessionId?: string | null;
  isInspectorOpen?: boolean;
}

export const preferencesService = {
  getStorageKey(userId?: string | null): string {
    return userId ? `atelier_prefs_${userId}` : 'atelier_prefs_global';
  },

  /**
   * Synchronously reads the unified preferences object for the user.
   * Seamlessly migrates legacy individual keys on first read.
   */
  getPreferences(userId?: string | null): UserWorkspacePreferences {
    if (typeof window === 'undefined') return {};
    try {
      // 1. Primary: Read unified user preferences
      const primaryKey = this.getStorageKey(userId);
      const raw = localStorage.getItem(primaryKey);
      if (raw) {
        try {
          return JSON.parse(raw) as UserWorkspacePreferences;
        } catch {}
      }

      // 2. Fallback to global unauthenticated preferences
      if (userId) {
        const globalRaw = localStorage.getItem('atelier_prefs_global');
        if (globalRaw) {
          try {
            return JSON.parse(globalRaw) as UserWorkspacePreferences;
          } catch {}
        }
      }

      // 3. Backward Compatibility Migration: Assemble from legacy keys
      const legacyTheme = (localStorage.getItem('theme_preference') as 'dark' | 'light') || undefined;
      const legacyDirectModel = localStorage.getItem('selected_model_preference') || undefined;
      let legacyEffort: string | undefined;
      try {
        const rawModelPref = localStorage.getItem('model_preference');
        if (rawModelPref) {
          const parsedModel = JSON.parse(rawModelPref);
          if (parsedModel && typeof parsedModel === 'object') {
            legacyEffort = parsedModel.effort;
            if (!legacyDirectModel && parsedModel.modelId) {
              return {
                theme: legacyTheme,
                selectedModelId: parsedModel.modelId,
                selectedEffort: parsedModel.effort,
              };
            }
          }
        }
      } catch {}

      const legacyActiveSession = userId
        ? localStorage.getItem(`harness_current_session_id_${userId}`)
        : localStorage.getItem('harness_current_session_id');

      const migrated: UserWorkspacePreferences = {
        theme: legacyTheme,
        selectedModelId: legacyDirectModel,
        selectedEffort: legacyEffort,
        activeSessionId: legacyActiveSession || null,
      };

      return migrated;
    } catch {
      return {};
    }
  },

  /**
   * Atomically merges and saves updates to the unified preferences object.
   */
  updatePreferences(
    userId: string | null | undefined,
    updates: Partial<UserWorkspacePreferences>
  ): UserWorkspacePreferences {
    if (typeof window === 'undefined') return {};
    try {
      const current = this.getPreferences(userId);
      const merged: UserWorkspacePreferences = {
        ...current,
        ...updates,
      };

      const key = this.getStorageKey(userId);
      localStorage.setItem(key, JSON.stringify(merged));

      // Mirror to global fallback when operating unauthenticated
      if (!userId) {
        localStorage.setItem('atelier_prefs_global', JSON.stringify(merged));
      }

      return merged;
    } catch {
      return updates as UserWorkspacePreferences;
    }
  },

  /**
   * Cleans up preferences upon account sign-out or session invalidation.
   */
  clearUserPreferences(userId?: string | null): void {
    try {
      if (userId) {
        localStorage.removeItem(`atelier_prefs_${userId}`);
      }
      localStorage.removeItem('atelier_prefs_global');
      localStorage.removeItem('selected_model_preference');
      localStorage.removeItem('model_preference');
      localStorage.removeItem('harness_current_session_id');
      localStorage.removeItem('theme_preference');
    } catch {}
  },
};
