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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const createStripeCustomer = async (name: string, email: string) => {
    try {
        const customer = await stripe.customers.create({
            name,
            email
        });
        console.log('✅ Customer created:', customer.id);
        return customer.id;
    } catch (error) {
        console.error('❌ Error creating customer:', error);
        throw error;
    }
}

/**
 * FIXED: Validate and create customer if needed
 */
export const validateOrCreateCustomer = async (
    customerId: string | null | undefined,
    name: string,
    email: string
): Promise<string> => {
    try {
        // If no customer ID provided, create new one
        if (!customerId) {
            console.log('🆕 No customer ID provided, creating new customer');
            return await createStripeCustomer(name, email);
        }

        // Try to retrieve existing customer
        try {
            const customer = await stripe.customers.retrieve(customerId);
            
            // Check if customer was deleted
            if (customer.deleted) {
                console.log('⚠️ Customer was deleted, creating new customer');
                return await createStripeCustomer(name, email);
            }
            
            console.log('✅ Existing customer validated:', customerId);
            return customerId;
            
        } catch (retrieveError: any) {
            // Customer doesn't exist, create new one
            if (retrieveError.code === 'resource_missing' || retrieveError.statusCode === 404) {
                console.log('⚠️ Customer not found, creating new customer');
                return await createStripeCustomer(name, email);
            }
            
            // Other errors, re-throw
            throw retrieveError;
        }
    } catch (error) {
        console.error('❌ Error in validateOrCreateCustomer:', error);
        throw error;
    }
}

export const initPayment = async (
    amount: number, 
    customerId: string, 
    currency: Stripe.PaymentIntent["currency"] = "usd"
): Promise<StripeIntentData> => {
    try {
        console.log('🔄 Initializing payment:', { 
            amount, 
            customerId: customerId?.substring(0, 10) + '...', 
            currency 
        });
        
        // Validate inputs
        if (!customerId) {
            throw new Error('Customer ID is required');
        }
        if (amount <= 0) {
            throw new Error('Amount must be greater than 0');
        }

        // CRITICAL FIX: Validate customer exists before creating payment intent
        // This prevents the "Customer not found" error
        let validCustomerId = customerId;
        try {
            const customer = await stripe.customers.retrieve(customerId);
            
            // Check if customer was deleted
            if (customer.deleted) {
                console.error('❌ Customer was deleted:', customerId);
                throw new Error(`Customer ${customerId} was deleted. Please provide a valid customer ID.`);
            }
            
            console.log('✅ Customer validated:', customerId);
        } catch (customerError: any) {
            console.error('❌ Customer validation failed:', {
                customerId,
                error: customerError.message,
                code: customerError.code
            });
            
            // Provide helpful error message
            if (customerError.code === 'resource_missing' || customerError.statusCode === 404) {
                throw new Error(`Customer ${customerId} not found in Stripe. The customer ID may be invalid or from a different Stripe account.`);
            }
            
            throw new Error(`Customer validation failed: ${customerError.message}`);
        }

        // Create ephemeral key with correct API version
        const ephemeralKey = await stripe.ephemeralKeys.create(
            { customer: validCustomerId },
            { apiVersion: '2024-06-20' }
        );
        console.log('✅ Ephemeral key created');

        // Create payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency: currency,
            customer: validCustomerId,
            automatic_payment_methods: {
                enabled: true,
            },
        });

        console.log('✅ Payment intent created:', paymentIntent.id);

        return {
            paymentIntent: paymentIntent.client_secret,
            ephemeralKey: ephemeralKey.secret,
            paymentIntentId: paymentIntent.id,
            customerId: validCustomerId
        };
    } catch (error) {
        console.error('❌ Error in initPayment:', error);
        throw error;
    }
}

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

export const verifyStripePayment = async (paymentIntentId: string): Promise<PaymentVerificationResult> => {
    try {
        console.log('🔄 Verifying payment:', paymentIntentId);
        
        if (!paymentIntentId) {
            throw new Error('Payment Intent ID is required');
        }

        // Check if the payment intent exists and retrieve it
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ['charges.data']
        });

        console.log('✅ Payment intent found:', {
            id: paymentIntent.id,
            status: paymentIntent.status,
            amount: paymentIntent.amount
        });

        const result: PaymentVerificationResult = {
            success: paymentIntent.status === 'succeeded',
            status: paymentIntent.status,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            customer: paymentIntent.customer,
            paymentMethod: paymentIntent.payment_method,
            created: new Date(paymentIntent.created * 1000),
            lastPaymentError: paymentIntent.last_payment_error
        };

        if (paymentIntent.latest_charge) {
            result.charges = paymentIntent.latest_charge;
        }

        return result;
    } catch (error) {
        console.error('❌ Error verifying payment:', error);
        
        // Handle specific Stripe errors
        if (error instanceof Stripe.errors.StripeError) {
            if (error.code === 'resource_missing') {
                throw new Error(`Payment Intent ${paymentIntentId} not found. It may have been deleted or never existed.`);
            }
        }
        
        throw new Error(`Failed to verify payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export const updateStripePayment = async (
    paymentIntentId: string, 
    amount: number, 
    currency: string = "usd"
): Promise<StripeIntentData> => {
    try {
        console.log('🔄 Updating payment intent:', paymentIntentId);
        
        // First check if the payment intent exists
        const existingPaymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        if (existingPaymentIntent.status !== 'requires_payment_method' && 
            existingPaymentIntent.status !== 'requires_confirmation') {
            throw new Error(`Cannot update payment intent in status: ${existingPaymentIntent.status}`);
        }

        const updatedPaymentIntent = await stripe.paymentIntents.update(paymentIntentId, {
            currency: currency,
            amount: Math.round(amount * 100),
        });

        console.log('✅ Payment intent updated:', updatedPaymentIntent.id);

        return {
            paymentIntent: updatedPaymentIntent.client_secret,
            paymentIntentId: paymentIntentId,
        };
    } catch (error) {
        console.error('❌ Error updating payment:', error);
        throw error;
    }
}

// Helper function to check if payment intent exists
export const checkPaymentIntentExists = async (paymentIntentId: string): Promise<boolean> => {
    try {
        await stripe.paymentIntents.retrieve(paymentIntentId);
        return true;
    } catch (error) {
        if (error instanceof Stripe.errors.StripeError && error.code === 'resource_missing') {
            return false;
        }
        throw error;
    }
}

// Payment verification for booking confirmation
export const verifyPayment = async (paymentIntentId: string) => {
  try {
    console.log("🔍 Verifying payment intent:", paymentIntentId.substring(0, 15) + "...");
    
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    console.log("✅ Payment intent retrieved:", {
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      customer: typeof paymentIntent.customer === 'string' 
        ? paymentIntent.customer.substring(0, 10) + "..." 
        : "none",
    });
    
    return paymentIntent;
  } catch (error: any) {
    console.error("❌ Stripe verification error:", {
      message: error.message,
      type: error.type,
      code: error.code
    });
    
    // Re-throw with a more descriptive message
    if (error.type === 'StripeInvalidRequestError') {
      throw new Error(`Invalid payment intent: ${paymentIntentId}`);
    }
    throw error;
  }
};

// Export stripe instance for direct use in controllers
export { stripe };