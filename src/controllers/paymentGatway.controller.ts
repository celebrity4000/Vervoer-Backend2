import Stripe from "stripe";
import dotenv from "dotenv";
import { Request, Response } from "express";
import { asyncHandler } from "../utils/asynchandler.js";
import { ApiResponse } from "../utils/apirespone.js";

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2025-06-30.basil",
});


export const createPayment = asyncHandler(
  async (req: Request, res: Response) => {
    const { amount, currency = "inr" } = req.body;

    if (!amount) {
      res.status(400).json({ success: false, message: "Amount is required" });
      return;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), 
      currency,
      payment_method_types: ["card"],
    });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          success: true,
          clientSecret: paymentIntent.client_secret,
        },
        "Payment intent created successfully"
      )
    );
  }
);
