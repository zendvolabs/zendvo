import { relations } from "drizzle-orm";
import {
  boolean,
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
import { supportedCurrencyCodes } from "@/lib/currency";

export const userStatusEnum = pgEnum("user_status", [
  "unverified",
  "active",
  "suspended",
]);
export const giftStatusEnum = pgEnum("gift_status", [
  "pending_otp",
  "otp_verified",
  "pending_review",
  "confirmed",
  "completed",
  "sent",
  "failed",
]);
export const transactionTypeEnum = pgEnum("transaction_type", [
  "deposit",
  "withdrawal",
  "transfer",
]);
export const transactionStatusEnum = pgEnum("transaction_status", [
  "pending",
  "completed",
  "failed",
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
  },
  (table) => {
    return [
      unique("users_phone_number_unique").on(table.phoneNumber),
      unique("users_email_unique").on(table.email),
      unique("users_username_unique").on(table.username),
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
  },
  (table) => {
    return [
      index("ev_user_id_idx").on(table.userId),
      index("ev_expires_at_idx").on(table.expiresAt),
    ];
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

export const gifts = pgTable(
  "gifts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    senderId: uuid("sender_id").references(() => users.id),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id),
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
    paymentReference: text("payment_reference"),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => {
    return [
      index("gift_sender_id_idx").on(table.senderId),
      index("gift_recipient_id_idx").on(table.recipientId),
      index("gift_status_idx").on(table.status),
      index("gift_sender_email_recipient_idx").on(
        table.senderEmail,
        table.recipientId,
      ),
      index("gift_share_link_token_idx").on(table.shareLinkToken),
      index("gift_slug_idx").on(table.slug),
      index("gift_short_code_idx").on(table.shortCode),
      index("gift_blockchain_tx_hash_idx").on(table.blockchainTxHash),
      unique("gift_payment_reference_unique").on(table.paymentReference),
    ];
  },
);

export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    currency: text("currency").notNull(),
    balance: doublePrecision("balance").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => {
    return [
      unique("wallet_user_currency_key").on(table.userId, table.currency),
      index("wallet_user_id_idx").on(table.userId),
    ];
  },
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    read: boolean("read").default(false).notNull(),
    metadata: text("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => {
    return [
      index("notif_user_id_idx").on(table.userId),
      index("notif_created_at_idx").on(table.createdAt),
    ];
  },
);

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    country: text("country").notNull(),
    currency: text("currency").notNull(),
    swiftBic: text("swift_bic").notNull(),
    accountNumber: text("account_number").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => {
    return [
      index("bank_accounts_user_id_idx").on(table.userId),
    ];
  },
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    walletId: uuid("wallet_id").references(() => wallets.id),
    type: transactionTypeEnum("type").notNull(),
    status: transactionStatusEnum("status").default("pending").notNull(),
    amount: doublePrecision("amount").notNull(),
    currency: text("currency").notNull(),
    reference: text("reference"),
    provider: text("provider"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => {
    return [
      index("tx_user_id_idx").on(table.userId),
      index("tx_wallet_id_idx").on(table.walletId),
      index("tx_created_at_idx").on(table.createdAt),
    ];
  },
);

export const usersRelations = relations(users, ({ many }) => ({
  emailVerifications: many(emailVerifications),
  passwordResets: many(passwordResets),
  refreshTokens: many(refreshTokens),
  sentGifts: many(gifts, { relationName: "sentGifts" }),
  receivedGifts: many(gifts, { relationName: "receivedGifts" }),
  wallets: many(wallets),
  bankAccounts: many(bankAccounts),
  notifications: many(notifications),
  transactions: many(transactions),
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

export const walletsRelations = relations(wallets, ({ one, many }) => ({
  user: one(users, {
    fields: [wallets.userId],
    references: [users.id],
  }),
  transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, {
    fields: [transactions.userId],
    references: [users.id],
  }),
  wallet: one(wallets, {
    fields: [transactions.walletId],
    references: [wallets.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const bankAccountsRelations = relations(bankAccounts, ({ one }) => ({
  user: one(users, {
    fields: [bankAccounts.userId],
    references: [users.id],
  }),
}));

export const webhookRetryQueue = pgTable("WebhookRetryQueue", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  retryCount: integer("retry_count").default(0).notNull(),
  maxRetries: integer("max_retries").default(5).notNull(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
