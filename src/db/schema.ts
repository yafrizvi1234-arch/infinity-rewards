import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull().default(''),
  photoUrl: text('photo_url').notNull().default(''),
  specialty: text('specialty').notNull().default('Member'),
  activeAccent: text('active_accent').notNull().default('cyan'),
  totalPoints: integer('total_points').notNull().default(0),
  totalVisits: integer('total_visits').notNull().default(0),
  successfulVisits: integer('successful_visits').notNull().default(0),
  visitedToday: integer('visited_today').notNull().default(0),
  unlockedShopIds: jsonb('unlocked_shop_ids').$type<string[]>().notNull().default([]),
  followersCount: integer('followers_count').notNull().default(0),
  followingCount: integer('following_count').notNull().default(0),
  isDiscoverable: boolean('is_discoverable').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const follows = pgTable('follows', {
  id: text('id').primaryKey(),
  followerId: text('follower_id').notNull(),
  followerName: text('follower_name').notNull(),
  followerUsername: text('follower_username').notNull(),
  followerAvatar: text('follower_avatar').notNull().default(''),
  targetId: text('target_id').notNull(),
  targetName: text('target_name').notNull(),
  targetUsername: text('target_username').notNull(),
  targetAvatar: text('target_avatar').notNull().default(''),
  isRealTarget: boolean('is_real_target').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const activities = pgTable('activities', {
  id: text('id').primaryKey(),
  uid: text('uid').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default('General'),
  pointsDelta: integer('points_delta').notNull().default(0),
  targetId: text('target_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const links = pgTable('links', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  ownerName: text('owner_name').notNull(),
  ownerUsername: text('owner_username').notNull(),
  ownerAvatar: text('owner_avatar').notNull().default(''),
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  url: text('url').notNull(),
  normalizedUrl: text('normalized_url').notNull(),
  urlKey: text('url_key').notNull().unique(),
  domain: text('domain').notNull(),
  isHttps: boolean('is_https').notNull().default(true),
  category: text('category').notNull().default('Other'),
  status: text('status').notNull().default('pending'),
  cooldownSec: integer('cooldown_sec').notNull().default(64800),
  targetGeos: jsonb('target_geos')
    .$type<string[]>()
    .notNull()
    .default(['US', 'UK', 'UAE', 'AU']),
  reportCount: integer('report_count').notNull().default(0),
  moderationNote: text('moderation_note'),
  moderatedBy: text('moderated_by'),
  moderatedAt: timestamp('moderated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const linkVisits = pgTable('link_visits', {
  id: text('id').primaryKey(),
  uid: text('uid').notNull(),
  linkId: text('link_id').notNull(),
  linkTitle: text('link_title').notNull(),
  linkType: text('link_type').notNull(),
  category: text('category').notNull().default('Other'),
  domain: text('domain').notNull(),
  url: text('url').notNull(),
  durationSec: integer('duration_sec').notNull().default(25),
  cooldownSec: integer('cooldown_sec').notNull().default(64800),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const linkReports = pgTable('link_reports', {
  id: text('id').primaryKey(),
  linkId: text('link_id').notNull(),
  linkTitle: text('link_title').notNull(),
  linkUrl: text('link_url').notNull(),
  reporterId: text('reporter_id').notNull(),
  reporterUsername: text('reporter_username').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('open'),
  adminNote: text('admin_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const moderationLogs = pgTable('moderation_logs', {
  id: text('id').primaryKey(),
  linkId: text('link_id').notNull(),
  linkTitle: text('link_title').notNull(),
  targetOwnerId: text('target_owner_id').notNull(),
  action: text('action').notNull(),
  reason: text('reason').notNull(),
  adminUid: text('admin_uid').notNull(),
  adminEmail: text('admin_email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const paymentConfig = pgTable('payment_config', {
  id: text('id').primaryKey(),
  bkashNumber: text('bkash_number').notNull(),
  nagadNumber: text('nagad_number').notNull(),
  updatedBy: text('updated_by'),
  updatedByEmail: text('updated_by_email'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const paymentRequests = pgTable('payment_requests', {
  id: text('id').primaryKey(),
  uid: text('uid').notNull(),
  userName: text('user_name').notNull(),
  userUsername: text('user_username').notNull(),
  planId: text('plan_id').notNull().default('multi_5'),
  amountBdt: integer('amount_bdt').notNull().default(50),
  paymentMethod: text('payment_method').notNull(),
  paymentNumber: text('payment_number').notNull(),
  senderNumber: text('sender_number'),
  transactionId: text('transaction_id').notNull().unique(),
  screenshotUrl: text('screenshot_url').notNull(),
  status: text('status').notNull().default('pending'),
  adminNote: text('admin_note'),
  reviewedBy: text('reviewed_by'),
  reviewedByEmail: text('reviewed_by_email'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const multiEntitlements = pgTable('multi_entitlements', {
  uid: text('uid').primaryKey(),
  planId: text('plan_id').notNull().default('multi_5'),
  active: boolean('active').notNull().default(true),
  maxConcurrentLinks: integer('max_concurrent_links').notNull().default(5),
  amountBdt: integer('amount_bdt').notNull().default(50),
  sourceRequestId: text('source_request_id').notNull(),
  transactionId: text('transaction_id').notNull(),
  approvedBy: text('approved_by').notNull(),
  approvedByEmail: text('approved_by_email').notNull(),
  activatedAt: timestamp('activated_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const adsterraIntegrations = pgTable('adsterra_integrations', {
  uid: text('uid').primaryKey(),
  ownerUserId: text('owner_user_id').notNull(),
  connectionMode: text('connection_mode').notNull().default('manual_smartlink'),
  status: text('status').notNull().default('disconnected'),
  publisherId: text('publisher_id').notNull().default(''),
  publisherLabel: text('publisher_label').notNull().default(''),
  smartlinkUrl: text('smartlink_url').notNull().default(''),
  smartlinkTitle: text('smartlink_title').notNull().default(''),
  hasApiKey: boolean('has_api_key').notNull().default(false),
  apiKeyHint: text('api_key_hint').notNull().default(''),
  apiVerified: boolean('api_verified').notNull().default(false),
  verifiedDomainsCount: integer('verified_domains_count').notNull().default(0),
  verifiedPlacementsCount: integer('verified_placements_count').notNull().default(0),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userSmartlinks = pgTable('user_smartlinks', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  domain: text('domain').notNull(),
  category: text('category').notNull().default('Other'),
  isHttps: boolean('is_https').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const adsterraVault = pgTable('adsterra_vault', {
  uid: text('uid').primaryKey(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  ciphertext: text('ciphertext').notNull(),
  keyHint: text('key_hint').notNull(),
  apiVerified: boolean('api_verified').notNull().default(false),
  verifiedDomainsCount: integer('verified_domains_count').notNull().default(0),
  verifiedPlacementsCount: integer('verified_placements_count').notNull().default(0),
  domainsPreview: jsonb('domains_preview')
    .$type<Array<{ id: string; title: string }>>()
    .notNull()
    .default([]),
  placementsPreview: jsonb('placements_preview')
    .$type<
      Array<{
        id: string;
        domainId: string;
        title: string;
        type?: string;
        status?: string;
        directUrl?: string;
      }>
    >()
    .notNull()
    .default([]),
  statsSummary: jsonb('stats_summary').$type<Record<string, unknown> | null>(),
  detailedStats: jsonb('detailed_stats').$type<Record<string, unknown> | null>(),
  lastSyncedAtMs: bigint('last_synced_at_ms', { mode: 'number' }),
  updatedAtMs: bigint('updated_at_ms', { mode: 'number' }).notNull(),
});
