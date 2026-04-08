// Default extension settings
export const DEFAULT_SETTINGS = {
  scanIntervalMinutes: 360,
  notificationsEnabled: true,
  autoScanEnabled: true,
  lastScanTimestamp: null,
  authenticatedUserId: null,
  authenticatedScreenName: null,
};

// Fallback Bearer token (application-level, stable for years)
export const FALLBACK_BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// Known Followers query IDs (fallback when dynamic extraction fails)
export const FALLBACK_FOLLOWERS_QUERY_IDS = [
  'rRXFSG5vR6drKr5BPYjNvQ',
  't1lXKMpMELkAfA_GVmPe0g',
];

// GraphQL features object required by X's internal API
export const GRAPHQL_FEATURES = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

// Rate limiting configuration
export const RATE_LIMIT = {
  requestDelayMs: 3000,
  jitterMs: 2000,
  backoffBaseMs: 60000,
  backoffMaxMs: 900000,
  maxConsecutive429: 5,
  followersPerPage: 20,
};

// IndexedDB configuration
export const DB_NAME = 'xunfollowghost_db';
export const DB_VERSION = 1;

// Alarm name
export const SCAN_ALARM_NAME = 'xunfollowghost-periodic-scan';

// Storage keys for chrome.storage.local
export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  SCAN_STATE: 'scanState',
  AUTH_CONFIG: 'authConfig',
};
