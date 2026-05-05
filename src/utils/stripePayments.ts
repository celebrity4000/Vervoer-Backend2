import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("NO_STRIPE_APIKEY");
}
if (!process.env.STRIPE_PUBLIC_KEY) {
  throw new Error("NO STRIPE_PUBLIC_KEY AVAILABLE");
}

export const StripePublicKey = process.env.STRIPE_PUBLIC_KEY;

export interface StripeIntentData {
  paymentIntent: string | null;
  ephemeralKey?: string;
  paymentIntentId: string;
  customerId?: string;
}

export interface WalletIntentData extends StripeIntentData {
  walletsEnabled: true;
  supportedWallets: ("apple_pay" | "google_pay" | "cashapp" | "link")[];
}

export interface WalletVerificationResult {
  success: boolean;
  status: string;
  amount: number;
  currency: string;
  walletType: "apple_pay" | "google_pay" | "cashapp" | "link" | "card" | "unknown";
  paymentIntentId: string;
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// ─────────────────────────────────────────────────────────────────────────────
// Fee constants
// Platform keeps: serviceFee + transactionFee + estimatedTaxes
// Merchant receives: baseAmount (totalAmount before fees)
// These must match the fee percentages used in pricing helpers.
// ─────────────────────────────────────────────────────────────────────────────

export const PLATFORM_FEE_RATE = 0.05;  // 5%  service fee
export const TAX_RATE          = 0.15;  // 15% estimated taxes
export const TRANSACTION_FEE   = 0.50;  // flat $0.50

/**
 * Given the total amount charged to the customer, compute how much the
 * merchant should receive (i.e. total minus all platform fees).
 *
 * Formula (mirrors pricing helpers across all three booking types):
 *   total = base * (1 + 0.05 + 0.15) + 0.50
 *   base  = (total - 0.50) / 1.20
 */
export function computeMerchantPayout(totalChargedDollars: number): number {
  const base = (totalChargedDollars - TRANSACTION_FEE) / (1 + PLATFORM_FEE_RATE + TAX_RATE);
  return Math.max(0, base);
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer helpers
// ─────────────────────────────────────────────────────────────────────────────

export const createStripeCustomer = async (name: string, email: string) => {
  try {
    const customer = await stripe.customers.create({ name, email });
    console.log("✅ Customer created:", customer.id);
    return customer.id;
  } catch (error) {
    console.error("❌ Error creating customer:", error);
    throw error;
  }
};

export const validateOrCreateCustomer = async (
  customerId: string | null | undefined,
  name: string,
  email: string
): Promise<string> => {
  try {
    if (!customerId) {
      console.log("🆕 No customer ID provided, creating new customer");
      return await createStripeCustomer(name, email);
    }
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.deleted) {
        console.log("⚠️ Customer was deleted, creating new customer");
        return await createStripeCustomer(name, email);
      }
      console.log("✅ Existing customer validated:", customerId);
      return customerId;
    } catch (retrieveError: any) {
      if (retrieveError.code === "resource_missing" || retrieveError.statusCode === 404) {
        console.log("⚠️ Customer not found, creating new customer");
        return await createStripeCustomer(name, email);
      }
      throw retrieveError;
    }
  } catch (error) {
    console.error("❌ Error in validateOrCreateCustomer:", error);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Stripe Connect — merchant account helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an Express Connect account for a merchant and return the account ID.
 * Store the returned `stripeAccountId` on the Merchant document.
 */
export const createMerchantConnectAccount = async (
  email: string,
  country: string = "US"
): Promise<string> => {
  try {
    const account = await stripe.accounts.create({
      type:    "express",
      email,
      country,
      capabilities: {
        card_payments: { requested: true },
        transfers:     { requested: true },
      },
    });
    console.log("✅ Merchant Connect account created:", account.id);
    return account.id;
  } catch (error) {
    console.error("❌ Error creating Connect account:", error);
    throw error;
  }
};

/**
 * Generate an onboarding link so the merchant can complete KYC on Stripe.
 */
export const createMerchantOnboardingLink = async (
  stripeAccountId: string,
  refreshUrl: string,
  returnUrl: string
): Promise<string> => {
  try {
    const accountLink = await stripe.accountLinks.create({
      account:     stripeAccountId,
      refresh_url: refreshUrl,
      return_url:  returnUrl,
      type:        "account_onboarding",
    });
    console.log("✅ Onboarding link created for:", stripeAccountId);
    return accountLink.url;
  } catch (error) {
    console.error("❌ Error creating onboarding link:", error);
    throw error;
  }
};

/**
 * Check whether a merchant's Connect account has completed onboarding
 * (i.e. charges_enabled is true).
 */
export const isMerchantPayoutsEnabled = async (
  stripeAccountId: string
): Promise<boolean> => {
  try {
    const account = await stripe.accounts.retrieve(stripeAccountId);
    return account.charges_enabled === true;
  } catch {
    return false;
  }
};

/**
 * Delete / unlink a merchant's Connect account.
 * In live mode Stripe does not allow deletion — we just null out the DB field.
 * This function returns true if the account was deleted (test mode only),
 * false if it is a live account that must be unlinked only in DB.
 */
export const deleteMerchantConnectAccount = async (
  stripeAccountId: string
): Promise<boolean> => {
  try {
    await stripe.accounts.del(stripeAccountId);
    return true;
  } catch (err: any) {
    // Live accounts cannot be deleted via API — treat as soft-unlink
    console.warn("⚠️ Could not delete Connect account (live mode?):", err.message);
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// initPayment — with Stripe Connect destination charge
//
// When `merchantStripeAccountId` is supplied AND the merchant has completed
// onboarding, the PaymentIntent uses a destination charge:
//   • Full `amount` is charged to the customer on YOUR platform account.
//   • Stripe automatically transfers `merchantPayout` to the merchant's
//     connected account after the payment succeeds.
//   • Your platform retains the difference (serviceFee + taxes + transactionFee).
//
// When `merchantStripeAccountId` is omitted or merchant not yet onboarded,
// falls back to a plain PaymentIntent — no transfer.
// ─────────────────────────────────────────────────────────────────────────────

export const initPayment = async (
  amount: number,
  customerId: string,
  currency: Stripe.PaymentIntent["currency"] = "usd",
  merchantStripeAccountId?: string | null,
): Promise<StripeIntentData> => {
  try {
    console.log("🔄 Initializing payment:", {
      amount,
      customerId:  customerId?.substring(0, 10) + "...",
      currency,
      hasMerchant: !!merchantStripeAccountId,
    });

    if (!customerId) throw new Error("Customer ID is required");
    if (amount <= 0)  throw new Error("Amount must be greater than 0");

    // ── Validate customer ─────────────────────────────────────────────────
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.deleted) throw new Error(`Customer ${customerId} was deleted.`);
      console.log("✅ Customer validated:", customerId);
    } catch (customerError: any) {
      if (customerError.code === "resource_missing" || customerError.statusCode === 404) {
        throw new Error(`Customer ${customerId} not found in Stripe.`);
      }
      throw new Error(`Customer validation failed: ${customerError.message}`);
    }

    // ── Ephemeral key ─────────────────────────────────────────────────────
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: "2024-06-20" }
    );
    console.log("✅ Ephemeral key created");

    // ── Resolve transfer + on_behalf_of ───────────────────────────────────
    let transferData:  Stripe.PaymentIntentCreateParams["transfer_data"] | undefined;
    let onBehalfOf:    string | undefined;

    if (merchantStripeAccountId) {
      const payoutsEnabled = await isMerchantPayoutsEnabled(merchantStripeAccountId);

      if (payoutsEnabled) {
        const merchantPayoutDollars = computeMerchantPayout(amount);
        const merchantPayoutCents   = Math.round(merchantPayoutDollars * 100);

        transferData = {
          destination: merchantStripeAccountId,
          amount:      merchantPayoutCents,
        };
        // ✅ on_behalf_of is required with transfer_data for destination charges.
        // It tells Stripe which connected account the charge is "for", so the
        // correct statement descriptor and dispute handling are applied.
        onBehalfOf = merchantStripeAccountId;

        console.log(
          `✅ Destination charge: merchant=${merchantStripeAccountId}`,
          `  total=$${amount.toFixed(2)}`,
          `  merchantPayout=$${merchantPayoutDollars.toFixed(2)}`,
          `  platformFee=$${(amount - merchantPayoutDollars).toFixed(2)}`
        );
      } else {
        console.warn(
          `⚠️  Merchant ${merchantStripeAccountId} has not completed onboarding.`,
          "Falling back to plain PaymentIntent — no transfer."
        );
      }
    }

    // ── Create PaymentIntent ──────────────────────────────────────────────
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(amount * 100),
      currency,
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      ...(transferData && { transfer_data: transferData }),
      ...(onBehalfOf  && { on_behalf_of:  onBehalfOf  }),
    });
    console.log("✅ Payment intent created:", paymentIntent.id);

    return {
      paymentIntent:   paymentIntent.client_secret,
      ephemeralKey:    ephemeralKey.secret,
      paymentIntentId: paymentIntent.id,
      customerId,
    };
  } catch (error) {
    console.error("❌ Error in initPayment:", error);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Apple Pay / Google Pay domain helpers
// ─────────────────────────────────────────────────────────────────────────────

export const registerApplePayDomain = async (domain: string) => {
  try {
    const result = await stripe.applePayDomains.create({ domain_name: domain });
    console.log("✅ Apple Pay domain registered:", result.domain_name);
    return { success: true, domain: result.domain_name };
  } catch (error: any) {
    console.error("❌ Apple Pay domain registration failed:", error.message);
    throw error;
  }
};

export const listApplePayDomains = async () => {
  try {
    const domains = await stripe.applePayDomains.list({ limit: 20 });
    return domains.data;
  } catch (error: any) {
    console.error("❌ Failed to list Apple Pay domains:", error.message);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// initPaymentWithWallets
// ─────────────────────────────────────────────────────────────────────────────

export const initPaymentWithWallets = async (
  amount: number,
  customerId: string,
  currency: Stripe.PaymentIntent["currency"] = "usd",
  metadata: Record<string, string> = {}
): Promise<WalletIntentData> => {
  try {
    if (!customerId) throw new Error("Customer ID is required");
    if (amount <= 0)  throw new Error("Amount must be greater than 0");

    let validCustomerId = customerId;
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.deleted) {
        validCustomerId = await createStripeCustomer("", "");
      }
    } catch (customerError: any) {
      if (customerError.code === "resource_missing" || customerError.statusCode === 404) {
        validCustomerId = await createStripeCustomer("", "");
      } else {
        throw new Error(`Customer validation failed: ${customerError.message}`);
      }
    }

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: validCustomerId },
      { apiVersion: "2024-06-20" }
    );

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(amount * 100),
      currency,
      customer: validCustomerId,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: { ...metadata, wallets_enabled: "true", apple_pay: "true", google_pay: "true" },
    });

    return {
      paymentIntent:    paymentIntent.client_secret,
      ephemeralKey:     ephemeralKey.secret,
      paymentIntentId:  paymentIntent.id,
      customerId:       validCustomerId,
      walletsEnabled:   true,
      supportedWallets: ["apple_pay", "google_pay", "cashapp", "link"],
    };
  } catch (error) {
    console.error("❌ Error in initPaymentWithWallets:", error);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Verification helpers
// ─────────────────────────────────────────────────────────────────────────────

export const verifyWalletPayment = async (
  paymentIntentId: string
): Promise<WalletVerificationResult> => {
  try {
    if (!paymentIntentId) throw new Error("Payment Intent ID is required");

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    let walletType: WalletVerificationResult["walletType"] = "unknown";
    const pmId =
      typeof paymentIntent.payment_method === "string"
        ? paymentIntent.payment_method
        : paymentIntent.payment_method?.id;

    if (pmId) {
      try {
        const pm = await stripe.paymentMethods.retrieve(pmId);
        if (pm.card?.wallet?.type) {
          walletType = pm.card.wallet.type as WalletVerificationResult["walletType"];
        } else if (pm.type === "cashapp") {
          walletType = "cashapp";
        } else if (pm.type === "link") {
          walletType = "link";
        } else {
          walletType = "card";
        }
      } catch {
        walletType = "card";
      }
    }

    return {
      success:         paymentIntent.status === "succeeded",
      status:          paymentIntent.status,
      amount:          paymentIntent.amount,
      currency:        paymentIntent.currency,
      walletType,
      paymentIntentId: paymentIntent.id,
    };
  } catch (error) {
    console.error("❌ Wallet payment verification failed:", error);
    if (error instanceof Stripe.errors.StripeError && error.code === "resource_missing") {
      throw new Error(`Payment Intent ${paymentIntentId} not found.`);
    }
    throw new Error(
      `Wallet verification failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
};

interface PaymentVerificationResult {
  success: boolean;
  status: string;
  amount: number;
  currency: string;
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null;
  paymentMethod: string | Stripe.PaymentMethod | null;
  created: Date;
  lastPaymentError: Stripe.PaymentIntent.LastPaymentError | null;
  charges?: Stripe.Charge | string;
}

export const verifyStripePayment = async (
  paymentIntentId: string
): Promise<PaymentVerificationResult> => {
  try {
    if (!paymentIntentId) throw new Error("Payment Intent ID is required");

    const paymentIntent = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      { expand: ["charges.data"] }
    );

    const result: PaymentVerificationResult = {
      success:          paymentIntent.status === "succeeded",
      status:           paymentIntent.status,
      amount:           paymentIntent.amount,
      currency:         paymentIntent.currency,
      customer:         paymentIntent.customer,
      paymentMethod:    paymentIntent.payment_method,
      created:          new Date(paymentIntent.created * 1000),
      lastPaymentError: paymentIntent.last_payment_error,
    };

    if (paymentIntent.latest_charge) {
      result.charges = paymentIntent.latest_charge;
    }

    return result;
  } catch (error) {
    console.error("❌ Error verifying payment:", error);
    if (error instanceof Stripe.errors.StripeError && error.code === "resource_missing") {
      throw new Error(`Payment Intent ${paymentIntentId} not found.`);
    }
    throw new Error(
      `Failed to verify payment: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
};

export const updateStripePayment = async (
  paymentIntentId: string,
  amount: number,
  currency: string = "usd"
): Promise<StripeIntentData> => {
  try {
    const existingPaymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (
      existingPaymentIntent.status !== "requires_payment_method" &&
      existingPaymentIntent.status !== "requires_confirmation"
    ) {
      throw new Error(
        `Cannot update payment intent in status: ${existingPaymentIntent.status}`
      );
    }

    const updatedPaymentIntent = await stripe.paymentIntents.update(
      paymentIntentId,
      { currency, amount: Math.round(amount * 100) }
    );

    return {
      paymentIntent:   updatedPaymentIntent.client_secret,
      paymentIntentId,
    };
  } catch (error) {
    console.error("❌ Error updating payment:", error);
    throw error;
  }
};

export const checkPaymentIntentExists = async (
  paymentIntentId: string
): Promise<boolean> => {
  try {
    await stripe.paymentIntents.retrieve(paymentIntentId);
    return true;
  } catch (error) {
    if (
      error instanceof Stripe.errors.StripeError &&
      error.code === "resource_missing"
    ) {
      return false;
    }
    throw error;
  }
};

export const verifyPayment = async (paymentIntentId: string) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    console.log("✅ Payment intent retrieved:", {
      id:       paymentIntent.id,
      status:   paymentIntent.status,
      amount:   paymentIntent.amount,
      currency: paymentIntent.currency,
    });
    return paymentIntent;
  } catch (error: any) {
    console.error("❌ Stripe verification error:", error.message);
    if (error.type === "StripeInvalidRequestError") {
      throw new Error(`Invalid payment intent: ${paymentIntentId}`);
    }
    throw error;
  }
};

export const setupApplePayDomain = async () => {
  const domain = process.env.APP_DOMAIN;
  if (!domain) {
    console.log("ℹ️  APP_DOMAIN not set — skipping Apple Pay domain registration.");
    return;
  }
  try {
    const existing = await listApplePayDomains();
    if (existing.some((d) => d.domain_name === domain)) {
      console.log("✅ Apple Pay domain already registered:", domain);
      return;
    }
    await registerApplePayDomain(domain);
  } catch (error: any) {
    console.error("❌ Apple Pay setup failed:", error.message);
    throw error;
  }
};

export { stripe };