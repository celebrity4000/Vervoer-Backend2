import { Request, Response } from "express";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import { ParkingLotModel } from "../models/merchant.model.js";
import { Garage } from "../models/merchant.garage.model.js";
import { ResidenceModel } from "../models/merchant.residence.model.js";
import z from "zod/v4";

const UpdateMonthlySchema = z.object({
  venueType:            z.enum(["parking", "garage", "residence"]),
  venueId:              z.string(),
  monthlyChargeEnabled: z.boolean(),
  monthlyRate:          z.coerce.number().min(0),
});

const modelFor = (type: "parking" | "garage" | "residence") => {
  if (type === "parking")  return ParkingLotModel;
  if (type === "garage")   return Garage;
  return ResidenceModel;
};

/**
 * PATCH /merchants/monthly-settings
 * Body: { venueType, venueId, monthlyChargeEnabled, monthlyRate }
 */
export const updateMonthlySettings = asyncHandler(
  async (req: Request, res: Response) => {
    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "merchant" || !verifiedAuth.user) {
      throw new ApiError(401, "UNAUTHORIZED");
    }

    let parsed;
    try {
      parsed = UpdateMonthlySchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) throw new ApiError(400, "INVALID_DATA", err.issues);
      throw err;
    }

    const { venueType, venueId, monthlyChargeEnabled, monthlyRate } = parsed;
    const Model = modelFor(venueType);

    const venue = await Model.findById(venueId);
    if (!venue) throw new ApiError(404, "VENUE_NOT_FOUND");
    if (venue.owner.toString() !== verifiedAuth.user._id.toString()) {
      throw new ApiError(403, "UNAUTHORIZED_ACCESS");
    }

    const updated = await Model.findByIdAndUpdate(
      venueId,
      { $set: { monthlyChargeEnabled, monthlyRate } },
      { new: true }
    );

    res.status(200).json(
      new ApiResponse(200, {
        venueId,
        venueType,
        monthlyChargeEnabled: (updated as any).monthlyChargeEnabled,
        monthlyRate:          (updated as any).monthlyRate,
      }, "Monthly settings updated")
    );
  }
);