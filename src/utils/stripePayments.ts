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

// ── Wallet payment intent response (superset of StripeIntentData) ─────────────
export interface WalletIntentData extends StripeIntentData {
    walletsEnabled: true;
    supportedWallets: ("apple_pay" | "google_pay" | "cashapp" | "link")[];
}

// ── Result returned by verifyWalletPayment ────────────────────────────────────
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
// Original initPayment — unchanged, kept for backward compatibility
// ─────────────────────────────────────────────────────────────────────────────

export const initPayment = async (
    amount: number,
    customerId: string,
    currency: Stripe.PaymentIntent["currency"] = "usd"
): Promise<StripeIntentData> => {
    try {
        console.log("🔄 Initializing payment:", {
            amount,
            customerId: customerId?.substring(0, 10) + "...",
            currency,
        });

        if (!customerId) throw new Error("Customer ID is required");
        if (amount <= 0)  throw new Error("Amount must be greater than 0");

        let validCustomerId = customerId;
        try {
            const customer = await stripe.customers.retrieve(customerId);
            if (customer.deleted) {
                console.error("❌ Customer was deleted:", customerId);
                throw new Error(`Customer ${customerId} was deleted.`);
            }
            console.log("✅ Customer validated:", customerId);
        } catch (customerError: any) {
            console.error("❌ Customer validation failed:", {
                customerId,
                error: customerError.message,
                code:  customerError.code,
            });
            if (customerError.code === "resource_missing" || customerError.statusCode === 404) {
                throw new Error(`Customer ${customerId} not found in Stripe.`);
            }
            throw new Error(`Customer validation failed: ${customerError.message}`);
        }

        const ephemeralKey = await stripe.ephemeralKeys.create(
            { customer: validCustomerId },
            { apiVersion: "2024-06-20", stripeAccount: undefined }
        );
        console.log("✅ Ephemeral key created");

        const paymentIntent = await stripe.paymentIntents.create({
            amount:   Math.round(amount * 100),
            currency,
            customer: validCustomerId,
            automatic_payment_methods: { enabled: true },
        });
        console.log("✅ Payment intent created:", paymentIntent.id);

        return {
            paymentIntent:   paymentIntent.client_secret,
            ephemeralKey:    ephemeralKey.secret,
            paymentIntentId: paymentIntent.id,
            customerId:      validCustomerId,
        };
    } catch (error) {
        console.error("❌ Error in initPayment:", error);
        throw error;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// NEW ── Apple Pay / Google Pay domain registration
// Must be called once per domain that will host your web checkout.
// For React Native apps this is not required — wallets work via the SDK directly.
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
        console.log(
            "✅ Registered Apple Pay domains:",
            domains.data.map((d) => d.domain_name)
        );
        return domains.data;
    } catch (error: any) {
        console.error("❌ Failed to list Apple Pay domains:", error.message);
        throw error;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// NEW ── initPaymentWithWallets
// Drop-in replacement for initPayment when you want to support
// Apple Pay, Google Pay, CashApp Pay, and Link in addition to regular cards.
// Call this from your /users/payment-intent endpoint for CARD and UPI modes.
// ─────────────────────────────────────────────────────────────────────────────

export const initPaymentWithWallets = async (
    amount: number,
    customerId: string,
    currency: Stripe.PaymentIntent["currency"] = "usd",
    metadata: Record<string, string> = {}
): Promise<WalletIntentData> => {
    try {
        console.log("🔄 Initializing wallet-enabled payment:", {
            amount,
            customerId: customerId?.substring(0, 10) + "...",
            currency,
        });

        if (!customerId) throw new Error("Customer ID is required");
        if (amount <= 0)  throw new Error("Amount must be greater than 0");

        // ── Validate / recreate customer ──────────────────────────────────────
        let validCustomerId = customerId;
        try {
            const customer = await stripe.customers.retrieve(customerId);
            if (customer.deleted) {
                console.log("⚠️ Customer deleted, creating replacement");
                validCustomerId = await createStripeCustomer("", "");
            } else {
                console.log("✅ Customer validated:", customerId);
            }
        } catch (customerError: any) {
            if (
                customerError.code === "resource_missing" ||
                customerError.statusCode === 404
            ) {
                console.log("⚠️ Customer not found, creating new customer");
                validCustomerId = await createStripeCustomer("", "");
            } else {
                throw new Error(`Customer validation failed: ${customerError.message}`);
            }
        }

        // ── Ephemeral key ─────────────────────────────────────────────────────
        const ephemeralKey = await stripe.ephemeralKeys.create(
            { customer: validCustomerId },
            { apiVersion: "2024-06-20", stripeAccount: undefined }
        );
        console.log("✅ Ephemeral key created for wallet payment");

        // ── Payment intent
        //    automatic_payment_methods: enabled  →  Stripe enables every wallet
        //    the device supports (Apple Pay on iPhone, Google Pay on Android,
        //    CashApp on both, Link everywhere).
        //    allow_redirects: "never"            →  suppresses redirect-based
        //    methods (iDEAL, Bancontact …) that don't work in a mobile sheet.
        // ─────────────────────────────────────────────────────────────────────
        const paymentIntent = await stripe.paymentIntents.create({
            amount:   Math.round(amount * 100),
            currency,
            customer: validCustomerId,
            automatic_payment_methods: {
                enabled:          true,
                allow_redirects: "never",
            },
            metadata: {
                ...metadata,
                wallets_enabled:  "true",
                apple_pay:        "true",
                google_pay:       "true",
            },
        });
        console.log("✅ Wallet payment intent created:", paymentIntent.id);

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
// NEW ── verifyWalletPayment
// Extended verification that also detects which wallet was used.
// ─────────────────────────────────────────────────────────────────────────────

export const verifyWalletPayment = async (
    paymentIntentId: string
): Promise<WalletVerificationResult> => {
    try {
        console.log("🔍 Verifying wallet payment:", paymentIntentId.substring(0, 15) + "...");

        if (!paymentIntentId) throw new Error("Payment Intent ID is required");

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        // Detect wallet type from the payment method
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

        console.log("✅ Wallet payment verified:", {
            id:         paymentIntent.id,
            status:     paymentIntent.status,
            walletType,
        });

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

// ─────────────────────────────────────────────────────────────────────────────
// Original helpers — unchanged
// ─────────────────────────────────────────────────────────────────────────────

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
        console.log("🔄 Verifying payment:", paymentIntentId);
        if (!paymentIntentId) throw new Error("Payment Intent ID is required");

        const paymentIntent = await stripe.paymentIntents.retrieve(
            paymentIntentId,
            { expand: ["charges.data"] }
        );

        console.log("✅ Payment intent found:", {
            id:     paymentIntent.id,
            status: paymentIntent.status,
            amount: paymentIntent.amount,
        });

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
        console.log("🔄 Updating payment intent:", paymentIntentId);

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
        console.log("✅ Payment intent updated:", updatedPaymentIntent.id);

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
        console.log(
            "🔍 Verifying payment intent:",
            paymentIntentId.substring(0, 15) + "..."
        );
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        console.log("✅ Payment intent retrieved:", {
            id:       paymentIntent.id,
            status:   paymentIntent.status,
            amount:   paymentIntent.amount,
            currency: paymentIntent.currency,
            customer:
                typeof paymentIntent.customer === "string"
                    ? paymentIntent.customer.substring(0, 10) + "..."
                    : "none",
        });
        return paymentIntent;
    } catch (error: any) {
        console.error("❌ Stripe verification error:", {
            message: error.message,
            type:    error.type,
            code:    error.code,
        });
        if (error.type === "StripeInvalidRequestError") {
            throw new Error(`Invalid payment intent: ${paymentIntentId}`);
        }
        throw error;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// NEW ── One-time setup: call this script once from your server to register
// your domain for Apple Pay (only needed for web, not React Native).
// Usage: npx ts-node -e "require('./stripe').setupApplePayDomain()"
// ─────────────────────────────────────────────────────────────────────────────

export const setupApplePayDomain = async () => {
    const domain = process.env.APP_DOMAIN;
    if (!domain) {
        console.log(
            "ℹ️  APP_DOMAIN env var not set — skipping Apple Pay domain registration.\n" +
            "    For React Native apps this step is not required.\n" +
            "    For web checkout, set APP_DOMAIN=yourdomain.com and re-run."
        );
        return;
    }
    try {
        const existing = await listApplePayDomains();
        if (existing.some((d) => d.domain_name === domain)) {
            console.log("✅ Apple Pay domain already registered:", domain);
            return;
        }
        await registerApplePayDomain(domain);
        console.log("✅ Apple Pay setup complete for domain:", domain);
    } catch (error: any) {
        console.error("❌ Apple Pay setup failed:", error.message);
        throw error;
    }
};

export { stripe };