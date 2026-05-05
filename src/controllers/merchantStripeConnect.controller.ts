import { Request, Response } from "express";
import { asyncHandler }         from "../utils/asynchandler.js";
import { ApiError }             from "../utils/apierror.js";
import { ApiResponse }          from "../utils/apirespone.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import {
  createMerchantConnectAccount,
  createMerchantOnboardingLink,
  isMerchantPayoutsEnabled,
  deleteMerchantConnectAccount,
} from "../utils/stripePayments.js";
import { IMerchant, Merchant } from "../models/merchant.model.js";
import { toStripeCountryCode }  from "../utils/countryToIso.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helper — cast the auth result to IMerchant safely.
//
// MMerchentRes in verifyAuthhentication.ts is typed as `Document & IUser`
// (a typo — it should be & IMerchant). At runtime the object IS a Merchant
// document, so we cast through `any` to access IMerchant-specific fields
// like stripeAccountId and stripeOnboardingComplete.
// ─────────────────────────────────────────────────────────────────────────────
function asMerchant(user: any): IMerchant {
  return user as IMerchant;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/merchants/connect/onboard
//
// Creates a Stripe Express Connect account for the merchant (if they don't
// already have one), saves stripeAccountId to the DB, then returns a KYC URL
// the merchant opens in WebBrowser.
//
// If the merchant already has an account but hasn't finished KYC, it returns
// a fresh link so they can continue where they left off.
// ─────────────────────────────────────────────────────────────────────────────
export const createOrResumeOnboarding = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "merchant") {
      throw new ApiError(403, "UNAUTHORIZED — merchants only");
    }

    const merchant = asMerchant(verifiedAuth.user);

    const refreshUrl = `${process.env.APP_URL ?? "http://localhost:5000"}/api/merchants/connect/onboard`;
    const returnUrl  = `${process.env.APP_URL ?? "http://localhost:5000"}/api/merchants/connect/status`;

    // ── Already has a Connect account ─────────────────────────────────────
    if (merchant.stripeAccountId) {
      const chargesEnabled = await isMerchantPayoutsEnabled(merchant.stripeAccountId);

      if (chargesEnabled) {
        // Fully onboarded — sync DB if needed and return early
        if (!merchant.stripeOnboardingComplete) {
          await Merchant.findByIdAndUpdate(merchant._id, {
            stripeOnboardingComplete: true,
          });
        }
        res.status(200).json(
          new ApiResponse(200, {
            alreadyOnboarded: true,
            chargesEnabled:   true,
            stripeAccountId:  merchant.stripeAccountId,
          }, "Merchant is already fully onboarded.")
        );
        return;
      }

      // Has account but KYC incomplete — return a fresh link
      const onboardingUrl = await createMerchantOnboardingLink(
        merchant.stripeAccountId,
        refreshUrl,
        returnUrl,
      );
      res.status(200).json(
        new ApiResponse(200, {
          alreadyOnboarded: false,
          chargesEnabled:   false,
          stripeAccountId:  merchant.stripeAccountId,
          onboardingUrl,
        }, "Continue your Stripe onboarding.")
      );
      return;
    }

    // ── First time — create a new Express account ──────────────────────────
    const country = "US";   // ✅ converts "India" → "IN"
    const accountId = await createMerchantConnectAccount(merchant.email, country);

    await Merchant.findByIdAndUpdate(merchant._id, {
      stripeAccountId:          accountId,
      stripeOnboardingComplete: false,
    });

    const onboardingUrl = await createMerchantOnboardingLink(
      accountId,
      refreshUrl,
      returnUrl,
    );

    res.status(201).json(
      new ApiResponse(201, {
        stripeAccountId: accountId,
        onboardingUrl,
      }, "Stripe Connect account created. Complete onboarding via the URL.")
    );
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/merchants/connect/status
//
// Returns whether the merchant has a Connect account and whether
// charges_enabled is true (payouts flow automatically).
// Syncs stripeOnboardingComplete in DB when it first becomes true.
// ─────────────────────────────────────────────────────────────────────────────
export const getConnectStatus = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "merchant") {
      throw new ApiError(403, "UNAUTHORIZED — merchants only");
    }

    const merchant = asMerchant(verifiedAuth.user);

    if (!merchant.stripeAccountId) {
      res.status(200).json(
        new ApiResponse(200, {
          connected:      false,
          chargesEnabled: false,
        }, "No Stripe Connect account found.")
      );
      return;
    }

    const chargesEnabled = await isMerchantPayoutsEnabled(merchant.stripeAccountId);

    // Sync to DB the first time onboarding completes
    if (chargesEnabled && !merchant.stripeOnboardingComplete) {
      await Merchant.findByIdAndUpdate(merchant._id, {
        stripeOnboardingComplete: true,
      });
    }

    res.status(200).json(
      new ApiResponse(200, {
        connected:          true,
        chargesEnabled,
        stripeAccountId:    merchant.stripeAccountId,
        onboardingComplete: chargesEnabled,
      }, chargesEnabled
        ? "Merchant is fully onboarded. Payouts are enabled."
        : "Stripe account exists but onboarding is not yet complete."
      )
    );
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/merchants/connect/disconnect
//
// Unlinks the merchant's Stripe Connect account.
// In test mode Stripe allows deletion; in live mode we just null the DB field.
// After this the merchant falls back to plain PaymentIntents (no auto-split).
// ─────────────────────────────────────────────────────────────────────────────
export const disconnectConnectAccount = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "merchant") {
      throw new ApiError(403, "UNAUTHORIZED — merchants only");
    }

    const merchant = asMerchant(verifiedAuth.user);

    if (!merchant.stripeAccountId) {
      throw new ApiError(400, "NO_CONNECT_ACCOUNT — nothing to disconnect");
    }

    // Attempt deletion (works in test mode; silently skipped in live mode)
    await deleteMerchantConnectAccount(merchant.stripeAccountId);

    // Always null out DB fields regardless of Stripe API result
    await Merchant.findByIdAndUpdate(merchant._id, {
      stripeAccountId:          null,
      stripeOnboardingComplete: false,
    });

    res.status(200).json(
      new ApiResponse(200, null, "Stripe Connect account disconnected successfully.")
    );
  }
);