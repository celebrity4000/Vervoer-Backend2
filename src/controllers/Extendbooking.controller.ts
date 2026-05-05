import { Request, Response } from "express";
import z from "zod/v4";

import { asyncHandler }         from "../utils/asynchandler.js";
import { ApiError }             from "../utils/apierror.js";
import { ApiResponse }          from "../utils/apirespone.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import {
  validateOrCreateCustomer,
  initPayment,
  verifyPayment,
}                               from "../utils/stripePayments.js";
import { User }                 from "../models/normalUser.model.js";
import { IMerchant }            from "../models/merchant.model.js";

import { Garage, GarageBooking }                from "../models/merchant.garage.model.js";
import { ParkingLotModel, LotRentRecordModel }  from "../models/merchant.model.js";
import { ResidenceModel, ResidenceBookingModel } from "../models/merchant.residence.model.js";

// ─────────────────────────────────────────────────────────────────────────────
// Zod — request body for POST .../extend
// ─────────────────────────────────────────────────────────────────────────────

const ExtendBodySchema = z.object({
  extraHours:    z.coerce.number().min(1).max(72),
  paymentMethod: z.enum(["CASH", "CREDIT", "UPI"]).optional().default("CASH"),
});

// ─────────────────────────────────────────────────────────────────────────────
// Pricing helper — 2× rate for extension
// ─────────────────────────────────────────────────────────────────────────────

function computeExtensionPricing(hourlyRate: number, extraHours: number) {
  const doubleRate     = hourlyRate * 2;
  const baseAmount     = doubleRate * extraHours;
  const serviceFee     = baseAmount * 0.05;
  const transactionFee = 0.50;
  const estimatedTaxes = baseAmount * 0.15;
  const totalAmount    = baseAmount + serviceFee + transactionFee + estimatedTaxes;
  return { doubleRate, baseAmount, serviceFee, transactionFee, estimatedTaxes, totalAmount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe hourly-rate resolver
// ─────────────────────────────────────────────────────────────────────────────

function resolveHourlyRate(
  primaryRate: number | null | undefined,
  fallbackRate: number | null | undefined,
  bookingTotal: number | null | undefined,
  bookingFrom: string | Date | null | undefined,
  bookingTo: string | Date | null | undefined,
): number {
  if (primaryRate && primaryRate > 0) return primaryRate;
  if (fallbackRate && fallbackRate > 0) return fallbackRate;

  if (bookingTotal && bookingTotal > 0 && bookingFrom && bookingTo) {
    const durationMs  = new Date(bookingTo as string).getTime() - new Date(bookingFrom as string).getTime();
    const durationHrs = Math.max(1, Math.ceil(durationMs / 3_600_000));
    const derived     = bookingTotal / durationHrs;
    if (derived > 0) return derived;
  }

  throw new ApiError(400, "CANNOT_DERIVE_HOURLY_RATE");
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe Map / plain-object accessor for spacesList
// ─────────────────────────────────────────────────────────────────────────────

function getZonePrice(spacesList: any, zone: string): number | undefined {
  if (!spacesList) return undefined;
  if (typeof spacesList.get === "function") {
    return (spacesList as Map<string, any>).get(zone)?.price;
  }
  return (spacesList as Record<string, any>)[zone]?.price;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stripe helper
//
// ✅ CHANGED: now accepts merchantStripeAccountId and passes it to initPayment
//    so extensions also use destination charges — merchant receives their cut
//    automatically, platform keeps the fees.
// ─────────────────────────────────────────────────────────────────────────────

async function buildStripeIntent(
  user: any,
  amount: number,
  merchantStripeAccountId: string | null = null, // ✅ NEW
) {
  const validCustomerId = await validateOrCreateCustomer(
    user.stripeCustomerId,
    `${user.firstName} ${user.lastName}`,
    user.email,
  );
  if (validCustomerId !== user.stripeCustomerId) {
    await User.findByIdAndUpdate(user._id, { stripeCustomerId: validCustomerId });
  }
  // ✅ Pass merchantStripeAccountId → destination charge on extension too
  return await initPayment(amount, validCustomerId, "usd", merchantStripeAccountId);
}

// ═════════════════════════════════════════════════════════════════════════════
//  GARAGE
// ═════════════════════════════════════════════════════════════════════════════

// POST /merchants/garage/booking/:id/extend
export const extendGarageBooking = asyncHandler(async (req: Request, res: Response) => {
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "user") throw new ApiError(403, "UNAUTHORIZED");

  const bookingId                         = z.string().parse(req.params.id);
  const { extraHours, paymentMethod }     = ExtendBodySchema.parse(req.body);

  const booking = await GarageBooking.findById(bookingId);
  if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND");
  if (booking.customerId.toString() !== verifiedAuth.user._id.toString())
    throw new ApiError(403, "UNAUTHORIZED_ACCESS");

  const bookingStatus = booking.paymentDetails.status;
  if (bookingStatus !== "SUCCESS" && bookingStatus !== "PENDING")
    throw new ApiError(400, "BOOKING_NOT_EXTENDABLE");

  // ✅ Populate owner to access stripeAccountId
  const garage = await Garage.findById(booking.garageId).populate<{ owner: IMerchant }>("owner", "-password");
  if (!garage) throw new ApiError(404, "GARAGE_NOT_FOUND");

  const zone       = (booking.bookedSlot?.split("-")[0]) || "A";
  const zonePrice  = getZonePrice(garage.spacesList, zone);

  const hourlyRate = resolveHourlyRate(
    zonePrice,
    (booking as any).priceRate ?? garage.price,
    booking.paymentDetails?.totalAmount ?? (booking.paymentDetails as any)?.amountPaid,
    (booking.bookingPeriod as any)?.from,
    (booking.bookingPeriod as any)?.to,
  );

  const currentTo = new Date((booking.bookingPeriod as any)!.to as string);
  const newTo     = new Date(currentTo.getTime() + extraHours * 3_600_000);

  const conflict = await GarageBooking.findOne({
    _id:                     { $ne: booking._id },
    garageId:                booking.garageId,
    bookedSlot:              booking.bookedSlot,
    "paymentDetails.status": "SUCCESS",
    "bookingPeriod.from":    { $lt: newTo },
    "bookingPeriod.to":      { $gt: currentTo },
  });
  if (conflict) throw new ApiError(400, "EXTENSION_SLOT_NOT_AVAILABLE");

  const pricing = computeExtensionPricing(hourlyRate, extraHours);

  let stripeDetails: any = null;
  if (paymentMethod === "CREDIT") {
    // ✅ Pass merchant's stripeAccountId for destination charge
    const merchantStripeAccountId = (garage.owner as IMerchant).stripeAccountId ?? null;
    stripeDetails = await buildStripeIntent(verifiedAuth.user, pricing.totalAmount, merchantStripeAccountId);
  }

  const extension = {
    requestedAt:   new Date(),
    extraHours,
    previousTo:    currentTo,
    newTo,
    hourlyRate,
    ...pricing,
    paymentMethod,
    paymentStatus: paymentMethod === "CASH" ? "PENDING" : "AWAITING_CONFIRMATION",
    ...(stripeDetails && { stripeDetails }),
  };

  await GarageBooking.findByIdAndUpdate(bookingId, { $push: { extensions: extension } });

  res.status(200).json(new ApiResponse(200, {
    bookingId,
    type: "G",
    extraHours,
    previousTo:    currentTo,
    newTo,
    pricing,
    paymentMethod,
    ...(stripeDetails && { stripeDetails }),
    message: paymentMethod === "CASH"
      ? "Extension requested. Awaiting merchant cash confirmation."
      : "Stripe payment intent created. Complete payment to activate extension.",
  }));
});

// PATCH /merchants/garage/booking/:id/extend/confirm   (user — after Stripe sheet)
export const confirmGarageExtension = asyncHandler(async (req: Request, res: Response) => {
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "user") throw new ApiError(403, "UNAUTHORIZED");

  const bookingId           = z.string().parse(req.params.id);
  const { paymentIntentId } = req.body;
  if (!paymentIntentId) throw new ApiError(400, "PAYMENT_INTENT_ID_REQUIRED");

  const booking = await GarageBooking.findById(bookingId);
  if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND");
  if (booking.customerId.toString() !== verifiedAuth.user._id.toString())
    throw new ApiError(403, "UNAUTHORIZED_ACCESS");

  const extensions: any[] = (booking as any).extensions ?? [];

  console.log(
    `[confirmGarageExtension] bookingId=${bookingId} extensions:`,
    extensions.map((e: any) => ({ status: e.paymentStatus, method: e.paymentMethod }))
  );

  const pending = extensions.find((e: any) => e.paymentStatus === "AWAITING_CONFIRMATION");
  if (!pending) throw new ApiError(400, "NO_PENDING_STRIPE_EXTENSION");

  const paymentIntent = await verifyPayment(paymentIntentId);
  if (paymentIntent.status !== "succeeded")
    throw new ApiError(400, `PAYMENT_NOT_SUCCEEDED: intent status is "${paymentIntent.status}"`);

  await GarageBooking.findByIdAndUpdate(
    bookingId,
    {
      $set: {
        "bookingPeriod.to":                    pending.newTo,
        "extensions.$[ext].paymentStatus":     "SUCCESS",
        "extensions.$[ext].paymentIntentId":   paymentIntentId,
        "extensions.$[ext].activatedAt":       new Date(),
      },
    },
    { arrayFilters: [{ "ext.paymentStatus": "AWAITING_CONFIRMATION" }] },
  );

  res.status(200).json(new ApiResponse(200, {
    bookingId,
    newCheckOut: pending.newTo,
    newTo:       pending.newTo,
    message:     "Garage booking extended successfully.",
  }));
});

// PATCH /merchants/garage/booking/:id/extend/confirm-cash   (merchant)
export const confirmGarageExtensionCash = asyncHandler(async (req: Request, res: Response) => {
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "merchant") throw new ApiError(403, "MERCHANTS_ONLY");

  const bookingId = z.string().parse(req.params.id);

  const booking = await GarageBooking.findById(bookingId);
  if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND");

  const garage = await Garage.findById(booking.garageId);
  if (!garage) throw new ApiError(404, "GARAGE_NOT_FOUND");
  if (garage.owner.toString() !== verifiedAuth.user._id.toString())
    throw new ApiError(403, "NOT_YOUR_GARAGE");

  const extensions: any[] = (booking as any).extensions ?? [];
  const pending = extensions.find(
    (e: any) => e.paymentStatus === "PENDING" && e.paymentMethod === "CASH",
  );
  if (!pending) throw new ApiError(400, "NO_PENDING_CASH_EXTENSION");

  await GarageBooking.findByIdAndUpdate(
    bookingId,
    {
      $set: {
        "bookingPeriod.to":                  pending.newTo,
        "extensions.$[ext].paymentStatus":   "SUCCESS",
        "extensions.$[ext].activatedAt":     new Date(),
      },
    },
    { arrayFilters: [{ "ext.paymentStatus": "PENDING", "ext.paymentMethod": "CASH" }] },
  );

  res.status(200).json(new ApiResponse(200, {
    bookingId,
    newCheckOut: pending.newTo,
    newTo:       pending.newTo,
    message:     "Cash extension confirmed. Garage booking extended.",
  }));
});

// ═════════════════════════════════════════════════════════════════════════════
//  PARKING LOT
// ═════════════════════════════════════════════════════════════════════════════

// POST /merchants/parkinglot/booking/:id/extend
export const extendLotBooking = asyncHandler(async (req: Request, res: Response) => {
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "user") throw new ApiError(403, "UNAUTHORIZED");

  const bookingId                     = z.string().parse(req.params.id);
  const { extraHours, paymentMethod } = ExtendBodySchema.parse(req.body);

  const booking = await LotRentRecordModel.findById(bookingId);
  if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND");
  if (booking.renterInfo.toString() !== verifiedAuth.user._id.toString())
    throw new ApiError(403, "UNAUTHORIZED_ACCESS");

  const bookingStatus = booking.paymentDetails.status;
  if (bookingStatus !== "SUCCESS" && bookingStatus !== "PENDING")
    throw new ApiError(400, "BOOKING_NOT_EXTENDABLE");

  // ✅ Populate owner to access stripeAccountId
  const lot = await ParkingLotModel.findById(booking.lotId).populate<{ owner: IMerchant }>("owner", "-password");
  if (!lot) throw new ApiError(404, "LOT_NOT_FOUND");

  const hourlyRate = resolveHourlyRate(
    (booking as any).priceRate,
    lot.price,
    booking.paymentDetails?.totalAmount ?? (booking.paymentDetails as any)?.amountPaid,
    booking.rentFrom as any,
    booking.rentTo as any,
  );

  const currentTo = new Date(booking.rentTo as unknown as string);
  const newTo     = new Date(currentTo.getTime() + extraHours * 3_600_000);

  const conflict = await LotRentRecordModel.findOne({
    _id:                     { $ne: booking._id },
    lotId:                   booking.lotId,
    rentedSlot:              booking.rentedSlot,
    "paymentDetails.status": "SUCCESS",
    rentFrom:                { $lt: newTo },
    rentTo:                  { $gt: currentTo },
  });
  if (conflict) throw new ApiError(400, "EXTENSION_SLOT_NOT_AVAILABLE");

  const pricing = computeExtensionPricing(hourlyRate, extraHours);

  let stripeDetails: any = null;
  if (paymentMethod === "CREDIT") {
    // ✅ Pass merchant's stripeAccountId for destination charge
    const merchantStripeAccountId = (lot.owner as IMerchant).stripeAccountId ?? null;
    stripeDetails = await buildStripeIntent(verifiedAuth.user, pricing.totalAmount, merchantStripeAccountId);
  }

  const extension = {
    requestedAt:   new Date(),
    extraHours,
    previousTo:    currentTo,
    newTo,
    hourlyRate,
    ...pricing,
    paymentMethod,
    paymentStatus: paymentMethod === "CASH" ? "PENDING" : "AWAITING_CONFIRMATION",
    ...(stripeDetails && { stripeDetails }),
  };

  await LotRentRecordModel.findByIdAndUpdate(bookingId, { $push: { extensions: extension } });

  res.status(200).json(new ApiResponse(200, {
    bookingId,
    type: "L",
    extraHours,
    previousTo:    currentTo,
    newTo,
    pricing,
    paymentMethod,
    ...(stripeDetails && { stripeDetails }),
    message: paymentMethod === "CASH"
      ? "Extension requested. Awaiting merchant cash confirmation."
      : "Stripe payment intent created. Complete payment to activate extension.",
  }));
});

// PATCH /merchants/parkinglot/booking/:id/extend/confirm   (user — after Stripe sheet)
export const confirmLotExtension = asyncHandler(async (req: Request, res: Response) => {
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "user") throw new ApiError(403, "UNAUTHORIZED");

  const bookingId           = z.string().parse(req.params.id);
  const { paymentIntentId } = req.body;
  if (!paymentIntentId) throw new ApiError(400, "PAYMENT_INTENT_ID_REQUIRED");

  const booking = await LotRentRecordModel.findById(bookingId);
  if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND");
  if (booking.renterInfo.toString() !== verifiedAuth.user._id.toString())
    throw new ApiError(403, "UNAUTHORIZED_ACCESS");

  const extensions: any[] = (booking as any).extensions ?? [];

  console.log(
    `[confirmLotExtension] bookingId=${bookingId} extensions:`,
    extensions.map((e: any) => ({ status: e.paymentStatus, method: e.paymentMethod }))
  );

  const pending = extensions.find((e: any) => e.paymentStatus === "AWAITING_CONFIRMATION");
  if (!pending) throw new ApiError(400, "NO_PENDING_STRIPE_EXTENSION");

  const paymentIntent = await verifyPayment(paymentIntentId);
  if (paymentIntent.status !== "succeeded")
    throw new ApiError(400, `PAYMENT_NOT_SUCCEEDED: intent status is "${paymentIntent.status}"`);

  await LotRentRecordModel.findByIdAndUpdate(
    bookingId,
    {
      $set: {
        rentTo:                                pending.newTo,
        "extensions.$[ext].paymentStatus":     "SUCCESS",
        "extensions.$[ext].paymentIntentId":   paymentIntentId,
        "extensions.$[ext].activatedAt":       new Date(),
      },
    },
    { arrayFilters: [{ "ext.paymentStatus": "AWAITING_CONFIRMATION" }] },
  );

  res.status(200).json(new ApiResponse(200, {
    bookingId,
    newCheckOut: pending.newTo,
    newTo:       pending.newTo,
    message:     "Lot booking extended successfully.",
  }));
});

// PATCH /merchants/parkinglot/booking/:id/extend/confirm-cash   (merchant)
export const confirmLotExtensionCash = asyncHandler(async (req: Request, res: Response) => {
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "merchant") throw new ApiError(403, "MERCHANTS_ONLY");

  const bookingId = z.string().parse(req.params.id);

  const booking = await LotRentRecordModel.findById(bookingId);
  if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND");

  const lot = await ParkingLotModel.findById(booking.lotId);
  if (!lot) throw new ApiError(404, "LOT_NOT_FOUND");
  if (lot.owner.toString() !== verifiedAuth.user._id.toString())
    throw new ApiError(403, "NOT_YOUR_LOT");

  const extensions: any[] = (booking as any).extensions ?? [];
  const pending = extensions.find(
    (e: any) => e.paymentStatus === "PENDING" && e.paymentMethod === "CASH",
  );
  if (!pending) throw new ApiError(400, "NO_PENDING_CASH_EXTENSION");

  await LotRentRecordModel.findByIdAndUpdate(
    bookingId,
    {
      $set: {
        rentTo:                              pending.newTo,
        "extensions.$[ext].paymentStatus":  "SUCCESS",
        "extensions.$[ext].activatedAt":    new Date(),
      },
    },
    { arrayFilters: [{ "ext.paymentStatus": "PENDING", "ext.paymentMethod": "CASH" }] },
  );

  res.status(200).json(new ApiResponse(200, {
    bookingId,
    newCheckOut: pending.newTo,
    newTo:       pending.newTo,
    message:     "Cash extension confirmed. Lot booking extended.",
  }));
});

// ═════════════════════════════════════════════════════════════════════════════
//  RESIDENCE
// ═════════════════════════════════════════════════════════════════════════════

// POST /merchants/residence/booking/:id/extend
export const extendResidenceBooking = asyncHandler(async (req: Request, res: Response) => {
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "user") throw new ApiError(403, "UNAUTHORIZED");

  const bookingId                     = z.string().parse(req.params.id);
  const { extraHours, paymentMethod } = ExtendBodySchema.parse(req.body);

  const booking = await ResidenceBookingModel.findById(bookingId);
  if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND");
  if (booking.customerId.toString() !== verifiedAuth.user._id.toString())
    throw new ApiError(403, "UNAUTHORIZED_ACCESS");

  const bookingStatus = booking.paymentDetails.status;
  if (bookingStatus !== "SUCCESS" && bookingStatus !== "PENDING")
    throw new ApiError(400, "BOOKING_NOT_EXTENDABLE");

  // ✅ Populate owner to access stripeAccountId
  const residence = await ResidenceModel.findById(booking.residenceId).populate<{ owner: IMerchant }>("owner", "-password");
  if (!residence) throw new ApiError(404, "RESIDENCE_NOT_FOUND");

  const hourlyRate = resolveHourlyRate(
    booking.priceRate,
    residence.price,
    booking.totalAmount ?? booking.paymentDetails?.amount,
    booking.bookingPeriod?.from,
    booking.bookingPeriod?.to,
  );

  const currentTo = new Date(booking.bookingPeriod.to as unknown as string);
  const newTo     = new Date(currentTo.getTime() + extraHours * 3_600_000);

  const conflict = await ResidenceBookingModel.findOne({
    _id:                     { $ne: booking._id },
    residenceId:             booking.residenceId,
    "paymentDetails.status": "SUCCESS",
    "bookingPeriod.from":    { $lt: newTo },
    "bookingPeriod.to":      { $gt: currentTo },
  });
  if (conflict) throw new ApiError(400, "EXTENSION_SLOT_NOT_AVAILABLE");

  const pricing = computeExtensionPricing(hourlyRate, extraHours);

  let stripeDetails: any = null;
  if (paymentMethod === "CREDIT") {
    // ✅ Pass merchant's stripeAccountId for destination charge
    const merchantStripeAccountId = (residence.owner as IMerchant).stripeAccountId ?? null;
    stripeDetails = await buildStripeIntent(verifiedAuth.user, pricing.totalAmount, merchantStripeAccountId);
  }

  const extension = {
    requestedAt:   new Date(),
    extraHours,
    previousTo:    currentTo,
    newTo,
    hourlyRate,
    ...pricing,
    paymentMethod,
    paymentStatus: paymentMethod === "CASH" ? "PENDING" : "AWAITING_CONFIRMATION",
    ...(stripeDetails && { stripeDetails }),
  };

  await ResidenceBookingModel.findByIdAndUpdate(bookingId, { $push: { extensions: extension } });

  res.status(200).json(new ApiResponse(200, {
    bookingId,
    type: "R",
    extraHours,
    previousTo:    currentTo,
    newTo,
    pricing,
    paymentMethod,
    ...(stripeDetails && { stripeDetails }),
    message: paymentMethod === "CASH"
      ? "Extension requested. Awaiting merchant cash confirmation."
      : "Stripe payment intent created. Complete payment to activate extension.",
  }));
});

// PATCH /merchants/residence/booking/:id/extend/confirm   (user — after Stripe sheet)
export const confirmResidenceExtension = asyncHandler(async (req: Request, res: Response) => {
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "user") throw new ApiError(403, "UNAUTHORIZED");

  const bookingId           = z.string().parse(req.params.id);
  const { paymentIntentId } = req.body;
  if (!paymentIntentId) throw new ApiError(400, "PAYMENT_INTENT_ID_REQUIRED");

  const booking = await ResidenceBookingModel.findById(bookingId);
  if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND");
  if (booking.customerId.toString() !== verifiedAuth.user._id.toString())
    throw new ApiError(403, "UNAUTHORIZED_ACCESS");

  const extensions: any[] = (booking as any).extensions ?? [];

  console.log(
    `[confirmResidenceExtension] bookingId=${bookingId} extensions:`,
    extensions.map((e: any) => ({ status: e.paymentStatus, method: e.paymentMethod }))
  );

  const pending = extensions.find((e: any) => e.paymentStatus === "AWAITING_CONFIRMATION");
  if (!pending) throw new ApiError(400, "NO_PENDING_STRIPE_EXTENSION");

  const paymentIntent = await verifyPayment(paymentIntentId);
  if (paymentIntent.status !== "succeeded")
    throw new ApiError(400, `PAYMENT_NOT_SUCCEEDED: intent status is "${paymentIntent.status}"`);

  await ResidenceBookingModel.findByIdAndUpdate(
    bookingId,
    {
      $set: {
        "bookingPeriod.to":                    pending.newTo,
        "extensions.$[ext].paymentStatus":     "SUCCESS",
        "extensions.$[ext].paymentIntentId":   paymentIntentId,
        "extensions.$[ext].activatedAt":       new Date(),
      },
    },
    { arrayFilters: [{ "ext.paymentStatus": "AWAITING_CONFIRMATION" }] },
  );

  res.status(200).json(new ApiResponse(200, {
    bookingId,
    newCheckOut: pending.newTo,
    newTo:       pending.newTo,
    message:     "Residence booking extended successfully.",
  }));
});

// PATCH /merchants/residence/booking/:id/extend/confirm-cash   (merchant)
export const confirmResidenceExtensionCash = asyncHandler(async (req: Request, res: Response) => {
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "merchant") throw new ApiError(403, "MERCHANTS_ONLY");

  const bookingId = z.string().parse(req.params.id);

  const booking = await ResidenceBookingModel.findById(bookingId);
  if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND");

  const residence = await ResidenceModel.findById(booking.residenceId);
  if (!residence) throw new ApiError(404, "RESIDENCE_NOT_FOUND");
  if (residence.owner.toString() !== verifiedAuth.user._id.toString())
    throw new ApiError(403, "NOT_YOUR_RESIDENCE");

  const extensions: any[] = (booking as any).extensions ?? [];
  const pending = extensions.find(
    (e: any) => e.paymentStatus === "PENDING" && e.paymentMethod === "CASH",
  );
  if (!pending) throw new ApiError(400, "NO_PENDING_CASH_EXTENSION");

  await ResidenceBookingModel.findByIdAndUpdate(
    bookingId,
    {
      $set: {
        "bookingPeriod.to":                  pending.newTo,
        "extensions.$[ext].paymentStatus":  "SUCCESS",
        "extensions.$[ext].activatedAt":    new Date(),
      },
    },
    { arrayFilters: [{ "ext.paymentStatus": "PENDING", "ext.paymentMethod": "CASH" }] },
  );

  res.status(200).json(new ApiResponse(200, {
    bookingId,
    newCheckOut: pending.newTo,
    newTo:       pending.newTo,
    message:     "Cash extension confirmed. Residence booking extended.",
  }));
});