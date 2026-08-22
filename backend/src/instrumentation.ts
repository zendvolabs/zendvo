/** Runs startup checks and registers backend background jobs. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "edge") {
    const { checkMigrationStatus } = await import("./lib/db/migration-checker");

    console.log("🔍 Checking database migration status...");

    try {
      const status = await checkMigrationStatus();

      if (status.inSync) {
        console.log(status.message);
      } else {
        console.error(status.message);
        console.error(
          "⚠️  Server will continue, but database operations may fail.",
        );
        console.error(
          "   Run 'npm run db:migrate' or 'npx drizzle-kit push' to sync the database.",
        );

        if (
          process.env.NODE_ENV === "production" &&
          process.env.STRICT_MIGRATION_CHECK === "true"
        ) {
          console.error("❌ STRICT_MIGRATION_CHECK enabled. Halting startup.");
          process.exit(1);
        }
      }
    } catch (error) {
      console.error("❌ Failed to check migration status:", error);
      console.error(
        "⚠️  Server will continue, but this should be investigated.",
      );
    }

    // --- CRON JOB HERE ---
    try {
      console.log("⏰ Initializing background task schedulers...");
      const { startGiftReleaseJob } = await import("./server/jobs/giftReleaseJob");
      const { runTransactionVerifierCron } = await import(
        "./jobs/transaction_verifier"
      );
      
      startGiftReleaseJob();
      runTransactionVerifierCron();
      console.log("🚀 Scheduled Gift Release Cron Job successfully running.");
      console.log("🚀 Scheduled Transaction Verifier Cron Job successfully running.");
    } catch (cronError) {
      console.error("❌ Failed to initialize background cron jobs:", cronError);
    }
    // --------------------------------
  }
}
