import { Request, Response } from "express";
import Stripe from "stripe";
import { stripe } from "../utils/stripePayments.js";
import { GarageBooking }                              from "../models/merchant.garage.model.js";
import { LotRentRecordModel }                         from "../models/merchant.model.js";
import { ResidenceBookingModel }                      from "../models/merchant.residence.model.js";

// ─────────────────────────────────────────────────────────────────────────────
// POST /webhooks/stripe
//
// Stripe sends signed events here. We handle `payment_intent.succeeded` to
// confirm bookings server-side even if the mobile client disconnected before
// calling /book or /verify.
//
// IMPORTANT: this route must receive the RAW request body (Buffer), not the
// parsed JSON body. Register it in app.ts BEFORE app.use(express.json()):
//
//   import { stripeWebhook } from "./controllers/stripe.webhook.controller.js";
//   app.post(
//     "/webhooks/stripe",
//     express.raw({ type: "application/json" }),
//     stripeWebhook
//   );
// ─────────────────────────────────────────────────────────────────────────────

export const stripeWebhook = async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers["stripe-signature"] as string | undefined;

  if (!sig) {
    res.status(400).send("Missing stripe-signature header");
    return;
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("❌ STRIPE_WEBHOOK_SECRET is not set");
    res.status(500).send("Webhook secret not configured");
    return;
  }

  // ── Verify signature ──────────────────────────────────────────────────────
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,                            // must be raw Buffer — do NOT parse as JSON
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err: any) {
    console.error("❌ Webhook signature verification failed:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  console.log(`📨 Stripe webhook received: ${event.type}`);

  // ── Handle events ─────────────────────────────────────────────────────────
  switch (event.type) {

    // ── payment_intent.succeeded ───────────────────────────────────────────
    // Fired when Stripe confirms the charge. We use this as the authoritative
    // signal to mark bookings SUCCESS — catches cases where the mobile client
    // disconnected before calling /book or /verify.
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      console.log(`✅ PaymentIntent succeeded: ${intent.id}`);

      const now = new Date();

      // Each model stores the paymentIntentId in a slightly different path.
      // We attempt all three in parallel and ignore whichever don't match.
      const [garageResult, lotResult, residenceResult] = await Promise.allSettled([

        // Garage
        GarageBooking.findOneAndUpdate(
          {
            "paymentDetails.StripePaymentDetails.paymentIntentId": intent.id,
            "paymentDetails.status": { $in: ["PENDING", "AWAITING_CONFIRMATION"] },
          },
          {
            $set: {
              "paymentDetails.status": "SUCCESS",
              "paymentDetails.paidAt": now,
            },
          },
          { new: true }
        ),

        // Parking lot
        LotRentRecordModel.findOneAndUpdate(
          {
            "paymentDetails.stripePaymentDetails.paymentIntentId": intent.id,
            "paymentDetails.status": { $in: ["PENDING", "AWAITING_CONFIRMATION"] },
          },
          {
            $set: {
              "paymentDetails.status": "SUCCESS",
              "paymentDetails.paidAt": now,
            },
          },
          { new: true }
        ),

        // Residence
        ResidenceBookingModel.findOneAndUpdate(
          {
            "paymentDetails.StripePaymentDetails.paymentIntentId": intent.id,
            "paymentDetails.status": { $in: ["PENDING", "AWAITING_CONFIRMATION"] },
          },
          {
            $set: {
              "paymentDetails.status": "SUCCESS",
              "paymentDetails.paidAt": now,
            },
          },
          { new: true }
        ),
      ]);

      // Log which booking was confirmed (or if none matched)
      if (garageResult.status    === "fulfilled" && garageResult.value) {
        console.log(`✅ Garage booking confirmed via webhook: ${garageResult.value._id}`);
      }
      if (lotResult.status       === "fulfilled" && lotResult.value) {
        console.log(`✅ Lot booking confirmed via webhook: ${lotResult.value._id}`);
      }
      if (residenceResult.status === "fulfilled" && residenceResult.value) {
        console.log(`✅ Residence booking confirmed via webhook: ${residenceResult.value._id}`);
      }

      const anyConfirmed =
        (garageResult.status    === "fulfilled" && !!garageResult.value)    ||
        (lotResult.status       === "fulfilled" && !!lotResult.value)       ||
        (residenceResult.status === "fulfilled" && !!residenceResult.value);

      if (!anyConfirmed) {
        // This is normal when /book was called first and already set SUCCESS
        console.log(`ℹ️  No pending booking found for intent ${intent.id} — likely already confirmed by client`);
      }
      break;
    }

    // ── payment_intent.payment_failed ──────────────────────────────────────
    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      console.log(`❌ PaymentIntent failed: ${intent.id}`);

      // Mark any still-PENDING bookings as FAILED so the slot is freed
      await Promise.allSettled([
        GarageBooking.findOneAndUpdate(
          {
            "paymentDetails.StripePaymentDetails.paymentIntentId": intent.id,
            "paymentDetails.status": "PENDING",
          },
          { $set: { "paymentDetails.status": "FAILED" } }
        ),
        LotRentRecordModel.findOneAndUpdate(
          {
            "paymentDetails.stripePaymentDetails.paymentIntentId": intent.id,
            "paymentDetails.status": "PENDING",
          },
          { $set: { "paymentDetails.status": "FAILED" } }
        ),
        ResidenceBookingModel.findOneAndUpdate(
          {
            "paymentDetails.StripePaymentDetails.paymentIntentId": intent.id,
            "paymentDetails.status": "PENDING",
          },
          { $set: { "paymentDetails.status": "FAILED" } }
        ),
      ]);
      break;
    }

    // ── account.updated (Connect) ──────────────────────────────────────────
    // Fired whenever a connected account's details change, including when
    // charges_enabled flips to true after KYC completes.
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      console.log(`🔄 Connect account updated: ${account.id} chargesEnabled=${account.charges_enabled}`);

      if (account.charges_enabled) {
        // Sync stripeOnboardingComplete to true in DB
        const { Merchant } = await import("../models/merchant.model.js");
        await Merchant.findOneAndUpdate(
          { stripeAccountId: account.id },
          { $set: { stripeOnboardingComplete: true } }
        );
        console.log(`✅ Merchant onboarding complete synced for account: ${account.id}`);
      }
      break;
    }

    default:
      // Ignore all other event types
      console.log(`ℹ️  Unhandled webhook event type: ${event.type}`);
  }

  // Acknowledge receipt — Stripe retries if we don't respond 200 within 30 s
  res.status(200).json({ received: true });
};