import nodemailer from "nodemailer";

import User from "../models/User.js";

const ALERT_WINDOW_MS = 5 * 60 * 1000;

function configuredSmtp(config) {
  return Boolean(
    config?.SMTP_HOST &&
      config?.SMTP_PORT &&
      config?.SMTP_USER &&
      config?.SMTP_PASS &&
      config?.SMTP_FROM,
  );
}

function buildAlertMessage(counts) {
  return [
    `Fraud monitoring identified ${counts.total} transaction(s) that need attention.`,
    `High-risk transactions: ${counts.high}.`,
    `Transactions pending manual review: ${counts.pendingReview}.`,
  ].join("\n");
}

/**
 * Creates a best-effort merchant email alert service with a per-merchant debounce window.
 */
export function createAlertService({
  config = {},
  UserModel = User,
  logger = console,
  transporter,
  createTransport = nodemailer.createTransport,
  debounceMs = ALERT_WINDOW_MS,
  now = Date.now,
  setTimer = setTimeout,
} = {}) {
  const smtpConfigured = configuredSmtp(config);
  const mailer =
    transporter ??
    (smtpConfigured
      ? createTransport({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_PORT === 465,
          auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
        })
      : null);
  const merchantAlerts = new Map();

  function schedule(merchantId, state) {
    if (state.timer || state.sending || state.pending.total === 0) {
      return;
    }
    const delay =
      state.lastAttemptAt === null
        ? debounceMs
        : Math.max(0, debounceMs - (now() - state.lastAttemptAt));
    state.timer = setTimer(() => {
      state.timer = null;
      void flush(merchantId, state);
    }, delay);
    state.timer.unref?.();
  }

  async function flush(merchantId, state) {
    if (state.sending || state.pending.total === 0) {
      return;
    }
    if (
      state.lastAttemptAt !== null &&
      now() - state.lastAttemptAt < debounceMs
    ) {
      schedule(merchantId, state);
      return;
    }

    const summary = state.pending;
    state.pending = { total: 0, high: 0, pendingReview: 0 };
    state.lastAttemptAt = now();
    state.sending = true;
    try {
      const merchant = await UserModel.findById(merchantId).select("email");
      if (!merchant?.email) {
        logger.warn("Fraud alert could not be emailed because merchant email was not found.", {
          merchantId: String(merchantId),
          summary,
        });
        return;
      }
      await mailer.sendMail({
        from: config.SMTP_FROM,
        to: merchant.email,
        subject: `Fraud alert summary: ${summary.total} transaction(s)`,
        text: buildAlertMessage(summary),
      });
    } catch (error) {
      logger.error("Failed to send merchant fraud alert email.", {
        merchantId: String(merchantId),
        errorType: error?.name || "Error",
      });
    } finally {
      state.sending = false;
      schedule(merchantId, state);
      if (state.pending.total === 0 && !state.timer) {
        merchantAlerts.delete(String(merchantId));
      }
    }
  }

  /**
   * Enqueues an alert for a HIGH or unscored transaction without throwing to callers.
   */
  async function notifyTransactionAlert({ transaction, merchantId }) {
    if (
      transaction?.riskLabel !== "HIGH" &&
      transaction?.scoringStatus !== "pending_review"
    ) {
      return;
    }

    const key = String(merchantId ?? transaction.merchantId);
    const counts = {
      total: 1,
      high: transaction.riskLabel === "HIGH" ? 1 : 0,
      pendingReview: transaction.scoringStatus === "pending_review" ? 1 : 0,
    };
    if (!mailer) {
      logger.warn("Merchant fraud alert (SMTP is not configured).", {
        merchantId: key,
        ...counts,
      });
      return;
    }

    let state = merchantAlerts.get(key);
    if (!state) {
      state = {
        pending: { total: 0, high: 0, pendingReview: 0 },
        lastAttemptAt: null,
        sending: false,
        timer: null,
      };
      merchantAlerts.set(key, state);
    }
    state.pending.total += counts.total;
    state.pending.high += counts.high;
    state.pending.pendingReview += counts.pendingReview;
    schedule(key, state);
  }

  return { notifyTransactionAlert };
}
