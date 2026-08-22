import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum("user_status", [
  "unverified",
  "active",
  "suspended",
  "deleted",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name"),
    phoneNumber: text("phone_number"),
    username: text("username"),
    avatarUrl: text("avatar_url"),
    role: text("role").default("user").notNull(),
    status: userStatusEnum("status").default("unverified").notNull(),
    loginAttempts: integer("login_attempts").default(0).notNull(),
    lockUntil: timestamp("lock_until"),
    otpFailedAttempts: integer("otp_failed_attempts").default(0).notNull(),
    otpAttemptsWindowStart: timestamp("otp_attempts_window_start"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    lastLogin: timestamp("last_login"),
    lastOtpSentAt: timestamp("last_otp_sent_at"),
    isPhoneVerified: boolean("is_phone_verified").default(false).notNull(),
    phoneLast4: text("phone_last_4"),
    is2faEnabled: boolean("is_2fa_enabled").default(false).notNull(),
    totpSecret: text("totp_secret"),
    stellarAddress: text("stellar_address"),
  },
  (table) => {
    return [
      unique("users_phone_number_unique").on(table.phoneNumber),
      unique("users_email_unique").on(table.email),
      unique("users_username_unique").on(table.username),
      unique("users_stellar_address_unique").on(table.stellarAddress),
      index("users_phone_number_idx").on(table.phoneNumber),
      index("users_status_idx").on(table.status),
      index("users_created_at_idx").on(table.createdAt),
    ];
  },
);

export const emailVerifications = pgTable(
  "email_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    otpHash: text("otp_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    isUsed: boolean("is_used").default(false).notNull(),
    /**
     * Scopes this OTP record to a specific sensitive action.
     * NULL for general-purpose OTPs (e.g. email verification at signup).
     * Must be set when issuing OTPs for privileged actions so that a code
     * generated for one action cannot be redeemed for a different one.
     */
    action: text("action"),
  },
  (table) => {
    return [
      index("ev_user_id_idx").on(table.userId),
      index("ev_expires_at_idx").on(table.expiresAt),
      index("ev_user_action_idx").on(table.userId, table.action),
    ];
  },
);

/**
 * Tracks consumed action-token JTIs to enforce single-use semantics.
 * A cron job should periodically purge rows where expiresAt < now().
 */
export const usedActionTokens = pgTable(
  "used_action_tokens",
  {
    /** The JWT ID claim from the action token. */
    jti: text("jti").primaryKey(),
    /** Mirrors the token's exp claim — used by the cleanup cron. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => {
    return [index("uat_expires_at_idx").on(table.expiresAt)];
  },
);

export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    usedAt: timestamp("used_at"),
    ipAddress: text("ip_address"),
  },
  (table) => {
    return [
      index("pr_user_id_idx").on(table.userId),
      index("pr_expires_at_idx").on(table.expiresAt),
    ];
  },
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
    deviceInfo: text("device_info"),
    deviceId: text("device_id"),
    fingerprint: text("fingerprint"),
  },
  (table) => {
    return [index("rt_user_id_idx").on(table.userId)];
  },
);

export const giftStatusEnum = pgEnum("gift_status", [
  "pending_otp",
  "otp_verified",
  "pending_review",
  "confirmed",
  "completed",
  "sent",
  "failed",
]);

export const gifts = pgTable(
  "gifts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    senderId: uuid("sender_id").references(() => users.id),
    recipientId: uuid("recipient_id").notNull().references(() => users.id),
    amount: doublePrecision("amount").notNull(),
    fee: doublePrecision("fee").default(0).notNull(),
    totalAmount: doublePrecision("total_amount").notNull(),
    currency: text("currency").notNull(),
    message: text("message"),
    template: text("template"),
    status: giftStatusEnum("status").default("pending_otp").notNull(),
    otpHash: text("otp_hash"),
    otpExpiresAt: timestamp("otp_expires_at"),
    otpAttempts: integer("otp_attempts").default(0).notNull(),
    transactionId: text("transaction_id").unique(),
    blockchainTxHash: text("blockchain_tx_hash"),
    paymentReference: text("payment_reference").unique("gift_payment_reference_unique"),
    paymentProvider: text("payment_provider"),
    paymentVerifiedAt: timestamp("payment_verified_at"),
    hideAmount: boolean("hide_amount").default(false).notNull(),
    hideSender: boolean("hide_sender").default(false).notNull(),
    isAnonymous: boolean("is_anonymous").default(false).notNull(),
    unlockDatetime: timestamp("unlock_datetime"),
    senderName: text("sender_name"),
    senderEmail: text("sender_email"),
    senderAvatar: text("sender_avatar"),
    shareLink: text("share_link").unique(),
    shareLinkToken: text("share_link_token").unique(),
    slug: text("slug").unique(),
    shortCode: text("short_code").unique(),
    coverImageId: text("cover_image_id"),
    linkExpiresAt: timestamp("link_expires_at"),
    completedAt: timestamp("completed_at"),
    recipientPhone: text("recipient_phone"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("gift_sender_id_idx").on(table.senderId),
    index("gift_recipient_id_idx").on(table.recipientId),
    index("gift_status_idx").on(table.status),
    index("gift_sender_email_recipient_idx").on(table.senderEmail, table.recipientId),
    index("gift_share_link_token_idx").on(table.shareLinkToken),
    index("gift_slug_idx").on(table.slug),
    index("gift_short_code_idx").on(table.shortCode),
    index("gift_blockchain_tx_hash_idx").on(table.blockchainTxHash),
  ],
);

export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    currency: text("currency").notNull(),
    balance: doublePrecision("balance").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("wallet_user_currency_key").on(table.userId, table.currency),
    index("wallet_user_id_idx").on(table.userId),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    read: boolean("read").default(false).notNull(),
    metadata: text("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("notif_user_id_idx").on(table.userId),
    index("notif_created_at_idx").on(table.createdAt),
  ],
);

export const transactionStatusEnum = pgEnum("transaction_status", [
  "pending",
  "completed",
  "failed",
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "deposit",
  "withdrawal",
  "transfer",
]);

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    bankName: text("bank_name").notNull(),
    accountName: text("account_name").notNull(),
    accountNumberCiphertext: text("account_number_ciphertext").notNull(),
    accountNumberIv: text("account_number_iv").notNull(),
    accountNumberAuthTag: text("account_number_auth_tag").notNull(),
    accountNumberKeyVersion: integer("account_number_key_version")
      .default(1)
      .notNull(),
    accountNumberLast4: text("account_number_last_4").notNull(),
    accountNumberFingerprint: text("account_number_fingerprint").notNull(),
    country: text("country").notNull(),
    currency: text("currency").notNull(),
    routingNumber: text("routing_number"),
    sortCode: text("sort_code"),
    bankCode: text("bank_code"),
    swiftBic: text("swift_bic"),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("bank_accounts_user_id_idx").on(table.userId),
    unique("bank_accounts_user_fingerprint_key").on(
      table.userId,
      table.accountNumberFingerprint,
    ),
    check(
      "bank_accounts_last4_check",
      sql`char_length(${table.accountNumberLast4}) = 4`,
    ),
    check(
      "bank_accounts_key_version_check",
      sql`${table.accountNumberKeyVersion} > 0`,
    ),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    walletId: uuid("wallet_id").references(() => wallets.id),
    type: transactionTypeEnum("type").notNull(),
    status: transactionStatusEnum("status").default("pending").notNull(),
    amount: doublePrecision("amount").notNull(),
    currency: text("currency").notNull(),
    reference: text("reference"),
    provider: text("provider"),
    blockchainTxHash: text("blockchain_tx_hash"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("tx_user_id_idx").on(table.userId),
    index("tx_wallet_id_idx").on(table.walletId),
    index("tx_created_at_idx").on(table.createdAt),
    index("tx_blockchain_tx_hash_idx").on(table.blockchainTxHash),
  ],
);

export const giftsMetadata = pgTable("gifts_metadata", {
  id: uuid("id").defaultRandom().primaryKey(),
  contractGiftId: text("contract_gift_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id),
  message: text("message"),
  hideAmount: boolean("hide_amount").default(false).notNull(),
  stayAnonymous: boolean("stay_anonymous").default(false).notNull(),
  imageUrl: text("image_url"),
  processingFee: doublePrecision("processing_fee").default(0).notNull(),
  status: text("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const actionTokens = pgTable(
  "action_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    token: text("token").notNull().unique(),
    action: text("action").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    usedAt: timestamp("used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => [
    index("at_user_id_idx").on(table.userId),
    index("at_token_idx").on(table.token),
    index("at_expires_at_idx").on(table.expiresAt),
  ],
);

export const webhookRetryQueue = pgTable("WebhookRetryQueue", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  retryCount: integer("retry_count").default(0).notNull(),
  maxRetries: integer("max_retries").default(5).notNull(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  emailVerifications: many(emailVerifications),
  passwordResets: many(passwordResets),
  refreshTokens: many(refreshTokens),
  actionTokens: many(actionTokens),
  wallets: many(wallets),
  notifications: many(notifications),
  sentGifts: many(gifts, { relationName: "sentGifts" }),
  receivedGifts: many(gifts, { relationName: "receivedGifts" }),
  bankAccounts: many(bankAccounts),
  transactions: many(transactions),
  giftsMetadata: many(giftsMetadata),
}));

export const emailVerificationsRelations = relations(
  emailVerifications,
  ({ one }) => ({
    user: one(users, {
      fields: [emailVerifications.userId],
      references: [users.id],
    }),
  }),
);

export const passwordResetsRelations = relations(passwordResets, ({ one }) => ({
  user: one(users, {
    fields: [passwordResets.userId],
    references: [users.id],
  }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

export const actionTokensRelations = relations(actionTokens, ({ one }) => ({
  user: one(users, {
    fields: [actionTokens.userId],
    references: [users.id],
  }),
}));

export const giftsRelations = relations(gifts, ({ one }) => ({
  sender: one(users, {
    fields: [gifts.senderId],
    references: [users.id],
    relationName: "sentGifts",
  }),
  recipient: one(users, {
    fields: [gifts.recipientId],
    references: [users.id],
    relationName: "receivedGifts",
  }),
}));

export const walletsRelations = relations(wallets, ({ one, many }) => ({
  user: one(users, { fields: [wallets.userId], references: [users.id] }),
  transactions: many(transactions),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const bankAccountsRelations = relations(bankAccounts, ({ one }) => ({
  user: one(users, { fields: [bankAccounts.userId], references: [users.id] }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, { fields: [transactions.userId], references: [users.id] }),
  wallet: one(wallets, { fields: [transactions.walletId], references: [wallets.id] }),
}));

export const giftsMetadataRelations = relations(giftsMetadata, ({ one }) => ({
  user: one(users, { fields: [giftsMetadata.userId], references: [users.id] }),
}));

export const webhookRetryQueueRelations = relations(webhookRetryQueue, () => ({}));
