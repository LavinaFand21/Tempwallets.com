/**
 * Mixpanel Core Module
 *
 * Production-ready Mixpanel integration with proper identity management.
 * - Single initialization with stable device ID
 * - Correct anonymous → authenticated user transition
 * - No duplicate profiles on refresh
 * - Proper reset on logout
 */

import mixpanel from "mixpanel-browser";

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL STATE
// ═══════════════════════════════════════════════════════════════════════════

let initialized = false;
let identifiedUserId: string | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

const getToken = (): string | undefined => {
  if (typeof window === "undefined") return undefined;

  return (
    process.env.NEXT_PUBLIC_MIXPANEL_TOKEN ??
    process.env.NEXT_PUBLIC_MIXPANEL_TOKEN_DEV
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initialize Mixpanel SDK once at app startup.
 * Uses localStorage persistence for stable device ID across sessions.
 */
export const initMixpanel = (): boolean => {
  if (initialized) return true;
  if (typeof window === "undefined") return false;

  const token = getToken();
  if (!token) {
    if (process.env.NODE_ENV === "development") {
      console.debug("[Mixpanel] Token not configured — tracking disabled");
    }
    return false;
  }

  mixpanel.init(token, {
    // Persistence ensures stable device ID across page refreshes
    persistence: "localStorage",
    // Disable automatic pageview — we track manually for better control
    track_pageview: false,
    // Batch events for efficiency
    batch_requests: true,
    // Production: no debug logs
    debug: false,
    // Ignore DNT for consistent tracking (privacy handled by opt-out)
    ignore_dnt: true,
    // Cross-subdomain tracking
    cross_subdomain_cookie: true,
  });

  initialized = true;

  // Check if user was previously identified (survives page refresh)
  const storedUserId = mixpanel.get_property("$user_id");
  if (storedUserId) {
    identifiedUserId = storedUserId;
  }

  return true;
};

/**
 * Check if Mixpanel is ready to track events
 */
export const isInitialized = (): boolean => initialized;

/**
 * Get the current distinct_id (device ID for anonymous, user ID for identified)
 */
export const getDistinctId = (): string | null => {
  if (!initialized) return null;
  return mixpanel.get_distinct_id();
};

/**
 * Get the device ID (persists across identify/reset)
 */
export const getDeviceId = (): string | null => {
  if (!initialized) return null;
  return mixpanel.get_property("$device_id") ?? null;
};

// ═══════════════════════════════════════════════════════════════════════════
// IDENTITY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Identify a user after authentication.
 *
 * This merges the anonymous device history with the user profile.
 * Safe to call multiple times — only identifies once per session.
 *
 * @param userId - The authenticated user's ID (from your backend)
 * @param userProperties - Optional user profile properties
 */
export const identifyUser = (
  userId: string,
  userProperties?: {
    email?: string;
    name?: string;
    picture?: string;
    [key: string]: unknown;
  },
): void => {
  if (!initialized) {
    if (!initMixpanel()) return;
  }

  // Prevent re-identification of the same user (idempotent)
  if (identifiedUserId === userId) {
    // Still update profile properties if provided
    if (userProperties) {
      setUserProperties(userProperties);
    }
    return;
  }

  // Call identify — this links device_id to user_id
  mixpanel.identify(userId);
  identifiedUserId = userId;

  // Set profile properties
  if (userProperties) {
    const profileProps: Record<string, unknown> = {};

    if (userProperties.email) profileProps.$email = userProperties.email;
    if (userProperties.name) profileProps.$name = userProperties.name;
    if (userProperties.picture) profileProps.$avatar = userProperties.picture;

    // Add any additional properties
    Object.entries(userProperties).forEach(([key, value]) => {
      if (!["email", "name", "picture"].includes(key)) {
        profileProps[key] = value;
      }
    });

    mixpanel.people.set(profileProps);

    // Track first seen time (only set once)
    mixpanel.people.set_once({
      $created: new Date().toISOString(),
      first_login_at: new Date().toISOString(),
    });
  }

  // Register super properties for this user session
  mixpanel.register({
    user_id: userId,
    is_authenticated: true,
  });
};

/**
 * Update user profile properties without re-identifying
 */
export const setUserProperties = (
  properties: Record<string, unknown>,
): void => {
  if (!initialized || !identifiedUserId) return;

  const profileProps: Record<string, unknown> = {};

  if (properties.email) profileProps.$email = properties.email;
  if (properties.name) profileProps.$name = properties.name;
  if (properties.picture) profileProps.$avatar = properties.picture;

  Object.entries(properties).forEach(([key, value]) => {
    if (!["email", "name", "picture"].includes(key)) {
      profileProps[key] = value;
    }
  });

  mixpanel.people.set(profileProps);
};

/**
 * Increment a numeric property on the user profile
 */
export const incrementUserProperty = (property: string, value = 1): void => {
  if (!initialized || !identifiedUserId) return;
  mixpanel.people.increment(property, value);
};

/**
 * Reset Mixpanel on logout.
 * Clears identity and generates a new anonymous device ID.
 */
export const resetMixpanel = (): void => {
  if (!initialized) return;

  mixpanel.reset();
  identifiedUserId = null;

  // Clear super properties set during identification
  mixpanel.unregister("user_id");
  mixpanel.unregister("is_authenticated");
};

/**
 * Check if a user is currently identified
 */
export const isIdentified = (): boolean => identifiedUserId !== null;

/**
 * Get the currently identified user ID (null if anonymous)
 */
export const getIdentifiedUserId = (): string | null => identifiedUserId;

// ═══════════════════════════════════════════════════════════════════════════
// EVENT TRACKING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Track an event with automatic deduplication.
 *
 * @param eventName - Name of the event (use snake_case for consistency)
 * @param properties - Event properties
 */
export const trackEvent = (
  eventName: string,
  properties?: Record<string, unknown>,
): void => {
  if (!initialized) {
    if (!initMixpanel()) return;
  }

  // Generate unique insert_id for deduplication
  const insertId = `${eventName}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  mixpanel.track(eventName, {
    ...properties,
    $insert_id: insertId,
  });
};

/**
 * Track a timed event. Call this when an action starts,
 * then track the same event name when it completes.
 * The duration will be automatically calculated.
 */
export const timeEvent = (eventName: string): void => {
  if (!initialized) return;
  mixpanel.time_event(eventName);
};

/**
 * Register super properties that persist across events
 */
export const registerSuperProperties = (
  properties: Record<string, unknown>,
): void => {
  if (!initialized) return;
  mixpanel.register(properties);
};

/**
 * Register super properties only if they haven't been set before
 */
export const registerSuperPropertiesOnce = (
  properties: Record<string, unknown>,
): void => {
  if (!initialized) return;
  mixpanel.register_once(properties);
};

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY EXPORTS (backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════

export const trackMixpanelEvent = trackEvent;

/**
 * @deprecated alias() is deprecated in Simplified ID Merge — identify() handles everything
 * This is kept for backward compatibility but does nothing
 */
export const aliasUser = (_userId: string): void => {
  // No-op: alias() is deprecated in favor of identify()
};

// Export the raw mixpanel instance for advanced use cases
export default mixpanel;
