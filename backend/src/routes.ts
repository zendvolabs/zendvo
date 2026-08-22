import { Router, Request, Response, NextFunction } from "express";
import { makeExpressHandler } from "./adapter";
import {
  GET as bankAccountsGet,
  POST as bankAccountsPost,
  PUT as bankAccountsPut,
  DELETE as unlinkBankAccountDelete,
} from "./api/wallet/banks/route";
import { GET as walletBalanceGet } from "./api/wallet/balance/route";

// Streaming middleware to limit upload request size to 10MB without relying solely on Content-Length
const limitUploadSize = (req: Request, res: Response, next: NextFunction) => {
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const contentLength = parseInt(req.headers["content-length"] || "0", 10);

  if (!isNaN(contentLength) && contentLength > MAX_FILE_SIZE) {
    return res.status(413).json({
      type: "about:blank",
      title: "Payload Too Large",
      status: 413,
      detail: "Request body exceeds the 10MB limit.",
    });
  }

  let receivedBytes = 0;
  let isOverLimit = false;

  const onData = (chunk: Buffer) => {
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_FILE_SIZE && !isOverLimit) {
      isOverLimit = true;
      req.removeListener("data", onData);
      req.destroy();
      if (!res.headersSent) {
        return res.status(413).json({
          type: "about:blank",
          title: "Payload Too Large",
          status: 413,
          detail: "Request body exceeds the 10MB limit.",
        });
      }
    }
  };

  req.on("data", onData);
  next();
};

// Auth
import { POST as actionOtpPost } from "./api/auth/action-otp/route";
import { POST as authPost } from "./api/auth/route";
// Wallet
import { GET as walletTransactionsGet } from "./api/wallet/transactions/route";
import { POST as activateWalletPost } from "./api/wallet/activate";
// Dashboard
import { GET as dashboardStatsGet } from "./api/dashboard/stats/route";
import { POST as giftsMetadataPost } from "./api/gifts/metadata/route";
import { GET as dashboardGiftsGet } from "./api/dashboard/gifts/route";
// Gifts
import { POST as giftRedeemPost } from "./api/gifts/redeem/route";
import { POST as giftAppreciatePost } from "./api/gifts/appreciate/route";
// Users
import { GET as resolveRecipientGet } from "./api/users/resolve/route";
import { DELETE as deleteAccountDelete } from "./api/users/security/route";
import { POST as forgotPasswordPost } from "./api/auth/forgot-password/route";
import { POST as loginPost } from "./api/auth/login/route";
import { POST as logoutPost } from "./api/auth/logout/route";
import { GET as meGet } from "./api/auth/me/route";
import { POST as refreshPost } from "./api/auth/refresh/route";
import { POST as registerPost } from "./api/auth/register/route";
import { POST as resendOtpPost } from "./api/auth/resend-otp/route";
import { POST as resendVerificationPost } from "./api/auth/resend-verification/route";
import { POST as resetPasswordPost } from "./api/auth/reset-password/route";
import { POST as revokePost } from "./api/auth/revoke/route";
import { POST as sendOtpPost } from "./api/auth/send-otp/route";
import { POST as sendPhoneOtpPost } from "./api/auth/send-phone-otp/route";
import { POST as sendVerificationPost } from "./api/auth/send-verification/route";
import { POST as verifyEmailPost } from "./api/auth/verify-email/route";
import { POST as verifyOtpPost } from "./api/auth/verify-otp/route";
import { POST as verifyActionOtpPost } from "./api/auth/action-otp/verify/route";
import { POST as verifyDeletionOtpPost } from "./api/auth/verify-deletion-otp/route";

// Upload
import { POST as uploadImagePost } from "./api/upload/image/route";

export const apiRouter = Router();

// 1. Authentication routes
apiRouter.post("/api/auth", makeExpressHandler(authPost));
apiRouter.post("/api/auth/action-otp/send", makeExpressHandler(actionOtpPost));
apiRouter.post("/api/auth/action-otp", makeExpressHandler(actionOtpPost));
apiRouter.post(
  "/api/auth/forgot-password",
  makeExpressHandler(forgotPasswordPost),
);
apiRouter.post("/api/auth/login", makeExpressHandler(loginPost));
apiRouter.post("/api/auth/logout", makeExpressHandler(logoutPost));
apiRouter.get("/api/auth/me", makeExpressHandler(meGet));
apiRouter.post("/api/auth/refresh", makeExpressHandler(refreshPost));
apiRouter.post("/api/auth/register", makeExpressHandler(registerPost));
apiRouter.post("/api/auth/resend-otp", makeExpressHandler(resendOtpPost));
apiRouter.post(
  "/api/auth/resend-verification",
  makeExpressHandler(resendVerificationPost),
);
apiRouter.post(
  "/api/auth/reset-password",
  makeExpressHandler(resetPasswordPost),
);
apiRouter.post("/api/auth/revoke", makeExpressHandler(revokePost));
apiRouter.post("/api/auth/send-otp", makeExpressHandler(sendOtpPost));
apiRouter.post(
  "/api/auth/send-phone-otp",
  makeExpressHandler(sendPhoneOtpPost),
);
apiRouter.post(
  "/api/auth/send-verification",
  makeExpressHandler(sendVerificationPost),
);
apiRouter.post("/api/auth/verify-email", makeExpressHandler(verifyEmailPost));
apiRouter.post("/api/auth/verify-otp", makeExpressHandler(verifyOtpPost));
apiRouter.post(
  "/api/auth/action-otp/verify",
  makeExpressHandler(verifyActionOtpPost),
);
apiRouter.post(
  "/api/auth/verify-deletion-otp",
  makeExpressHandler(verifyDeletionOtpPost),
);

// 2. Dashboard routes
apiRouter.get("/api/dashboard/stats", makeExpressHandler(dashboardStatsGet));
apiRouter.get("/api/dashboard/gifts", makeExpressHandler(dashboardGiftsGet));

// 3. Gifts routes
apiRouter.post("/api/gifts/:id/redeem", makeExpressHandler(giftRedeemPost));
apiRouter.post("/api/gifts/redeem", makeExpressHandler(giftRedeemPost));
apiRouter.post(
  "/api/gifts/:id/appreciate",
  makeExpressHandler(giftAppreciatePost),
);
apiRouter.post("/api/gifts/appreciate", makeExpressHandler(giftAppreciatePost));

// 4. Users routes
apiRouter.get("/api/users/resolve", makeExpressHandler(resolveRecipientGet));
apiRouter.delete("/api/users/account", makeExpressHandler(deleteAccountDelete));

// 5. Wallet routes
apiRouter.post("/api/wallet/activate", makeExpressHandler(activateWalletPost));
