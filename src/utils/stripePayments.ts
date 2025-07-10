import Stripe from "stripe";

if(!process.env.STRIPE_SECRET_KEY){
    throw new Error("NO_STRIP_APIKEY")
}
if(!process.env.STRIPE_PUBLIC_KEY) throw new Error("NO STRIPE_PUBLIC_KEY AVALIABLE")
export const StripePublicKey = process.env.STRIPE_PUBLIC_KEY ;
export interface StripeIntentData {
  paymentIntent   : string | null;
  ephemeralKey?    : string ;
  paymentIntentId : string ;
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

export const createStripeCustomer = async(name : string , email : string)=>{
    const customer = await stripe.customers.create({
        name,email
    });
    
    return customer.id
}

export const initPayment = async (amount : number , customerId : string ,currency : Stripe.PaymentIntent["currency"] = "usd" ): Promise<StripeIntentData>=>{
    const ephemeralKey = await stripe.ephemeralKeys.create(
    {customer: customerId},
    {apiVersion: '2025-06-30.basil'}
  );
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount,
    currency: currency,
    customer: customerId,
    // In the latest version of the API, specifying the `automatic_payment_methods` parameter
    // is optional because Stripe enables its functionality by default.
    automatic_payment_methods: {
      enabled: true,
    },
  });
  return {
    paymentIntent: paymentIntent.client_secret,
    ephemeralKey: ephemeralKey.secret,
    paymentIntentId: paymentIntent.id
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

/**
 * Verifies if a payment was successfully completed
 * @param paymentIntentId The Stripe Payment Intent ID to verify
 * @returns Object containing payment status and details
 */
export const verifyStripePayment = async (paymentIntentId: string): Promise<PaymentVerificationResult> => {
    try {
        // Expand the charges to get charge details
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ['charges.data']
        });
        
        const result: PaymentVerificationResult = {
            success: paymentIntent.status === 'succeeded',
            status: paymentIntent.status,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            customer: paymentIntent.customer,
            paymentMethod: paymentIntent.payment_method,
            created: new Date(paymentIntent.created * 1000), // Convert to milliseconds
            lastPaymentError: paymentIntent.last_payment_error
        };

        // Add charge details if available
        if (paymentIntent.latest_charge) {
            result.charges = paymentIntent.latest_charge ;
        }
        
        return result;
    } catch (error) {
        console.error('Error verifying payment:', error);
        throw new Error(`Failed to verify payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}


export async function updateStripePayment(payIntenId : string , amount : number , currency: string = "usd"): Promise<StripeIntentData> {
    const updatedPayInten = await stripe.paymentIntents.update(payIntenId , {
        currency : currency , 
        amount : amount ,
    })
    return  {
        paymentIntent : updatedPayInten.client_secret, 
        paymentIntentId : payIntenId ,
    }
}

