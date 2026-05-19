import { Request, Response } from "express";
import { Model }             from "mongoose";
import { ApiError }          from "../utils/apierror.js";
import { ApiResponse }       from "../utils/apirespone.js";
import { asyncHandler }      from "../utils/asynchandler.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import { ParkingLotModel }   from "../models/merchant.model.js";
import { Garage }            from "../models/merchant.garage.model.js";
import { ResidenceModel }    from "../models/merchant.residence.model.js";
import z                     from "zod/v4";

const TimeString = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d$|^00:00$/,
    'Must be HH:MM in 24-hour format (e.g. "06:00"). Use "00:00" for midnight end-of-day.',
  );

const DailyRateSlotInput = z.object({
  label:    z.string().min(1, "Label is required"),
  fromTime: TimeString,
  toTime:   TimeString,
  price:    z.coerce.number().min(0, "Price must be ≥ 0"),
});

const UpdateDailyRateSchema = z
  .object({
    venueType:        z.enum(["parking", "garage", "residence"]),
    venueId:          z.string().min(1),
    dailyRateEnabled: z.boolean(),
    dailyRates:       z.array(DailyRateSlotInput).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.dailyRateEnabled && data.dailyRates.length === 0) {
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        path:    ["dailyRates"],
        message: "At least one slot is required when dailyRateEnabled is true",
      });
      return;
    }

    const toMins = (hhmm: string, asEnd = false) => {
      const [h, m] = hhmm.split(":").map(Number);
      const v = h * 60 + m;
      return asEnd && v === 0 ? 1440 : v;
    };

    for (let i = 0; i < data.dailyRates.length; i++) {
      const s = data.dailyRates[i];
      if (toMins(s.fromTime) >= toMins(s.toTime, true)) {
        ctx.addIssue({
          code:    z.ZodIssueCode.custom,
          path:    ["dailyRates", i, "toTime"],
          message: `Slot ${i + 1} ("${s.label}"): End time must be after start time. Use "00:00" for midnight.`,
        });
      }
    }

    const sorted = [...data.dailyRates]
      .map((s, idx) => ({ ...s, idx }))
      .sort((a, b) => toMins(a.fromTime) - toMins(b.fromTime));

    for (let i = 0; i < sorted.length - 1; i++) {
      const curr     = sorted[i];
      const next     = sorted[i + 1];
      const currTo   = toMins(curr.toTime, true);
      const nextFrom = toMins(next.fromTime);
      if (nextFrom < currTo) {
        ctx.addIssue({
          code:    z.ZodIssueCode.custom,
          path:    ["dailyRates", next.idx, "fromTime"],
          // ↓ human-readable message with slot numbers and labels
          message: `Slot ${next.idx + 1} ("${next.label}") overlaps with Slot ${curr.idx + 1} ("${curr.label}"). "${next.label}" starts at ${next.fromTime} but "${curr.label}" ends at ${curr.toTime}.`,
        });
      }
    }
  });

const modelFor = (type: "parking" | "garage" | "residence"): Model<any> => {
  if (type === "parking") return ParkingLotModel;
  if (type === "garage")  return Garage;
  return ResidenceModel;
};

export const updateDailyRateSettings = asyncHandler(
  async (req: Request, res: Response) => {

    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "merchant" || !verifiedAuth.user) {
      throw new ApiError(401, "UNAUTHORIZED");
    }

    // ── Validate ──────────────────────────────────────────────────────────────
    const result = UpdateDailyRateSchema.safeParse(req.body);

    if (!result.success) {
      // ↓ Send issues directly in the response — don't throw, respond immediately
      return res.status(400).json({
        success: false,
        message: "INVALID_DATA",
        issues: result.error.issues.map((issue) => ({
          path:    issue.path,
          message: issue.message,
        })),
      });
    }

    const { venueType, venueId, dailyRateEnabled, dailyRates } = result.data;

    const Model = modelFor(venueType);
    const venue = await Model.findById(venueId);
    if (!venue) throw new ApiError(404, "VENUE_NOT_FOUND");
    console.log("venue keys →", Object.keys(venue.toObject()));
console.log("venue owner-ish fields →", {
  owner:      venue.owner,
  merchantId: (venue as any).merchantId,
  createdBy:  (venue as any).createdBy,
  merchant:   (venue as any).merchant,
});

    if (venue.owner.toString() !== verifiedAuth.user._id.toString()) {
      throw new ApiError(403, "UNAUTHORIZED_ACCESS");
    }

    const updated = await Model.findByIdAndUpdate(
      venueId,
      { $set: { dailyRateEnabled, dailyRates } },
      { new: true, runValidators: true },
    );

    res.status(200).json(
      new ApiResponse(
        200,
        {
          venueId,
          venueType,
          dailyRateEnabled: (updated as any).dailyRateEnabled,
          dailyRates:       (updated as any).dailyRates,
        },
        "Daily rate settings updated successfully",
      ),
    );
  },
);

export const getDailyRateSettings = asyncHandler(
  async (req: Request, res: Response) => {
    let venueType: "parking" | "garage" | "residence";
    let venueId:   string;

    try {
      venueType = z.enum(["parking", "garage", "residence"]).parse(req.params.venueType);
      venueId   = z.string().min(1).parse(req.params.venueId);
    } catch (err) {
      if (err instanceof z.ZodError) throw new ApiError(400, "INVALID_PARAMS", err.issues);
      throw err;
    }

    const venue = await modelFor(venueType).findById(venueId).lean();
    if (!venue) throw new ApiError(404, "VENUE_NOT_FOUND");

    res.status(200).json(
      new ApiResponse(
        200,
        {
          venueId,
          venueType,
          dailyRateEnabled: (venue as any).dailyRateEnabled ?? false,
          dailyRates:       (venue as any).dailyRates       ?? [],
        },
        "Daily rate settings fetched",
      ),
    );
  },
);