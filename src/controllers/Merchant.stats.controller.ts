import { Request, Response } from "express";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import { ParkingLotModel, LotRentRecordModel } from "../models/merchant.model.js";
import { Garage, GarageBooking } from "../models/merchant.garage.model.js";
import { ResidenceModel, ResidenceBookingModel } from "../models/merchant.residence.model.js";
import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

interface DateBoundaries {
  now: Date;
  startOfDay: Date;
  startOfWeek: Date;
  startOfMonth: Date;
}

interface PeriodTotals {
  daily: number;
  weekly: number;
  monthly: number;
}

function getDateBoundaries(): DateBoundaries {
  const now = new Date();

  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const startOfWeek = new Date(now);
  const dayOfWeek = startOfWeek.getUTCDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() + diff);
  startOfWeek.setUTCHours(0, 0, 0, 0);

  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );

  return { now, startOfDay, startOfWeek, startOfMonth };
}

function aggregateEarnings(
  records: Array<{ paidAt?: Date | null; amount: number }>,
  b: DateBoundaries
): PeriodTotals {
  let daily = 0, weekly = 0, monthly = 0;
  for (const r of records) {
    if (!r.paidAt) continue;
    const paid = new Date(r.paidAt);
    if (paid >= b.startOfMonth) {
      monthly += r.amount;
      if (paid >= b.startOfWeek) {
        weekly += r.amount;
        if (paid >= b.startOfDay) daily += r.amount;
      }
    }
  }
  return { daily, weekly, monthly };
}

function aggregateBookingCounts(
  records: Array<{ paidAt?: Date | null }>,
  b: DateBoundaries
): PeriodTotals {
  let daily = 0, weekly = 0, monthly = 0;
  for (const r of records) {
    if (!r.paidAt) continue;
    const paid = new Date(r.paidAt);
    if (paid >= b.startOfMonth) {
      monthly++;
      if (paid >= b.startOfWeek) {
        weekly++;
        if (paid >= b.startOfDay) daily++;
      }
    }
  }
  return { daily, weekly, monthly };
}

function countCurrentlyBooked(
  bookings: Array<{ from: Date; to: Date; status: string }>,
  now: Date
): number {
  return bookings.filter(
    (b) =>
      b.status === "SUCCESS" &&
      new Date(b.from) <= now &&
      new Date(b.to) >= now
  ).length;
}

const MONTHLY_THRESHOLD_MS = 28 * 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────

export const getMerchantStats = asyncHandler(
  async (req: Request, res: Response) => {
    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "merchant" || !verifiedAuth.user) {
      throw new ApiError(401, "UNAUTHORIZED");
    }
    const merchantId = verifiedAuth.user._id as mongoose.Types.ObjectId;

    const boundaries = getDateBoundaries();
    const { now } = boundaries;

    // ── Fetch all venues ──────────────────────────────────────
    const [parkingLots, garages, residences] = await Promise.all([
      ParkingLotModel.find({ owner: merchantId }).lean(),
      Garage.find({ owner: merchantId }).lean(),
      ResidenceModel.find({ owner: merchantId }).lean(),
    ]);

    const parkingIds = parkingLots.map((p) => p._id);
    const garageIds  = garages.map((g) => g._id);
    const residenceIds = residences.map((r) => r._id);

    // ── Fetch all SUCCESS bookings ────────────────────────────
    const [parkingBookings, garageBookings, residenceBookings] = await Promise.all([
      LotRentRecordModel.find({
        lotId: { $in: parkingIds },
        "paymentDetails.status": "SUCCESS",
      }).populate("renterInfo", "firstName lastName").lean(),

      GarageBooking.find({
        garageId: { $in: garageIds },
        "paymentDetails.status": "SUCCESS",
      }).populate("customerId", "firstName lastName").lean(),

      ResidenceBookingModel.find({
        residenceId: { $in: residenceIds },
        "paymentDetails.status": "SUCCESS",
      }).populate("customerId", "firstName lastName").lean(),
    ]);

    // ── Parking Lots ──────────────────────────────────────────
    const parkingVenues = parkingLots.map((lot) => {
      const lotBookings = parkingBookings.filter(
        (b) => b.lotId.toString() === lot._id.toString()
      );

      const earnings = aggregateEarnings(
        lotBookings.map((b) => ({ paidAt: (b.paymentDetails as any)?.paidAt, amount: (b as any).amountToPaid ?? 0 })),
        boundaries
      );

      let totalSlots = 0;
      if (lot.spacesList) {
        for (const zone of (lot.spacesList as any).values?.() ?? Object.values(lot.spacesList)) {
          totalSlots += (zone as any).count ?? 0;
        }
      }

      const bookedNow = countCurrentlyBooked(
        lotBookings.map((b) => ({
          from: (b as any).rentFrom,
          to: (b as any).rentTo,
          status: (b.paymentDetails as any)?.status,
        })),
        now
      );

      const recentBookings = lotBookings
        .sort((a, b) => new Date((b as any).rentFrom).getTime() - new Date((a as any).rentFrom).getTime())
        .slice(0, 5)
        .map((b) => {
          const renter = b.renterInfo as any;
          return {
            _id: b._id.toString(),
            customerName: renter ? `${renter.firstName} ${renter.lastName ?? ""}`.trim() : "Unknown",
            slot: (b as any).rentedSlot ?? "",
            from: (b as any).rentFrom,
            to: (b as any).rentTo,
            amount: (b as any).amountToPaid ?? 0,
            status: (b.paymentDetails as any)?.status,
            paymentMethod: (b.paymentDetails as any)?.paymentMethod ?? "STRIPE",
            type: "parking" as const,
            isMonthly: false,
          };
        });

      return {
        id: lot._id.toString(),
        name: (lot as any).parkingName ?? "Unnamed Parking",
        type: "parking" as const,
        address: (lot as any).address ?? "",
        earnings,
        slots: { total: totalSlots, booked: bookedNow, available: Math.max(0, totalSlots - bookedNow) },
        monthlyChargeEnabled: false,
        monthlyRate: 0,
        activeMonthlySubscriptions: 0,
        recentBookings,
      };
    });

    // ── Garages ───────────────────────────────────────────────
    const garageVenues = garages.map((garage) => {
      const gBookings = garageBookings.filter(
        (b) => b.garageId.toString() === garage._id.toString()
      );

      const earnings = aggregateEarnings(
        gBookings.map((b) => ({ paidAt: (b.paymentDetails as any)?.paidAt, amount: (b as any).amountToPaid ?? 0 })),
        boundaries
      );

      let totalSlots = 0;
      if (garage.spacesList) {
        for (const zone of (garage.spacesList as any).values?.() ?? Object.values(garage.spacesList)) {
          totalSlots += (zone as any).count ?? 0;
        }
      }

      const bookedNow = countCurrentlyBooked(
        gBookings.map((b) => ({
          from: (b as any).bookingPeriod?.from,
          to: (b as any).bookingPeriod?.to,
          status: (b.paymentDetails as any)?.status,
        })),
        now
      );

      const monthlyChargeEnabled = !!(garage as any).monthlyChargeEnabled;
      const monthlyRate = (garage as any).monthlyRate ?? 0;

      const activeMonthlySubscriptions = gBookings.filter((b) => {
        const from = new Date((b as any).bookingPeriod?.from).getTime();
        const to   = new Date((b as any).bookingPeriod?.to).getTime();
        return (
          to - from >= MONTHLY_THRESHOLD_MS &&
          new Date((b as any).bookingPeriod?.from) <= now &&
          new Date((b as any).bookingPeriod?.to) >= now
        );
      }).length;

      const recentBookings = gBookings
        .sort((a, b) => new Date((b as any).bookingPeriod?.from).getTime() - new Date((a as any).bookingPeriod?.from).getTime())
        .slice(0, 5)
        .map((b) => {
          const customer = b.customerId as any;
          const from = (b as any).bookingPeriod?.from;
          const to   = (b as any).bookingPeriod?.to;
          return {
            _id: b._id.toString(),
            customerName: customer ? `${customer.firstName} ${customer.lastName ?? ""}`.trim() : "Unknown",
            slot: (b as any).bookedSlot ?? "",
            from,
            to,
            amount: (b as any).amountToPaid ?? 0,
            status: (b.paymentDetails as any)?.status,
            paymentMethod: (b.paymentDetails as any)?.method ?? "STRIPE",
            type: "garage" as const,
            isMonthly: new Date(to).getTime() - new Date(from).getTime() >= MONTHLY_THRESHOLD_MS,
          };
        });

      return {
        id: garage._id.toString(),
        name: (garage as any).garageName ?? "Unnamed Garage",
        type: "garage" as const,
        address: (garage as any).address ?? "",
        earnings,
        slots: { total: totalSlots, booked: bookedNow, available: Math.max(0, totalSlots - bookedNow) },
        monthlyChargeEnabled,
        monthlyRate,
        activeMonthlySubscriptions,
        recentBookings,
      };
    });

    // ── Residences ────────────────────────────────────────────
    const residenceVenues = residences.map((residence) => {
      const rBookings = residenceBookings.filter(
        (b) => b.residenceId.toString() === residence._id.toString()
      );

      const earnings = aggregateEarnings(
        rBookings.map((b) => ({ paidAt: (b.paymentDetails as any)?.paidAt, amount: (b as any).amountToPaid ?? 0 })),
        boundaries
      );

      const totalSlots = 1;
      const bookedNow = countCurrentlyBooked(
        rBookings.map((b) => ({
          from: (b as any).bookingPeriod?.from,
          to: (b as any).bookingPeriod?.to,
          status: (b.paymentDetails as any)?.status,
        })),
        now
      );

      const monthlyChargeEnabled = !!(residence as any).monthlyChargeEnabled;
      const monthlyRate = (residence as any).monthlyRate ?? 0;

      const activeMonthlySubscriptions = rBookings.filter((b) => {
        const from = new Date((b as any).bookingPeriod?.from).getTime();
        const to   = new Date((b as any).bookingPeriod?.to).getTime();
        return (
          to - from >= MONTHLY_THRESHOLD_MS &&
          new Date((b as any).bookingPeriod?.from) <= now &&
          new Date((b as any).bookingPeriod?.to) >= now
        );
      }).length;

      const recentBookings = rBookings
        .sort((a, b) => new Date((b as any).bookingPeriod?.from).getTime() - new Date((a as any).bookingPeriod?.from).getTime())
        .slice(0, 5)
        .map((b) => {
          const customer = b.customerId as any;
          const from = (b as any).bookingPeriod?.from;
          const to   = (b as any).bookingPeriod?.to;
          return {
            _id: b._id.toString(),
            customerName: customer ? `${customer.firstName} ${customer.lastName ?? ""}`.trim() : "Unknown",
            slot: "R-01",
            from,
            to,
            amount: (b as any).amountToPaid ?? 0,
            status: (b.paymentDetails as any)?.status,
            paymentMethod: (b.paymentDetails as any)?.method ?? "STRIPE",
            type: "residence" as const,
            isMonthly: new Date(to).getTime() - new Date(from).getTime() >= MONTHLY_THRESHOLD_MS,
          };
        });

      return {
        id: residence._id.toString(),
        name: (residence as any).residenceName ?? "Unnamed Residence",
        type: "residence" as const,
        address: (residence as any).address ?? "",
        earnings,
        slots: { total: totalSlots, booked: bookedNow, available: Math.max(0, totalSlots - bookedNow) },
        monthlyChargeEnabled,
        monthlyRate,
        activeMonthlySubscriptions,
        recentBookings,
      };
    });

    // ── Aggregate totals ──────────────────────────────────────
    const allVenues = [...parkingVenues, ...garageVenues, ...residenceVenues];

    const totalEarnings = allVenues.reduce(
      (acc, v) => ({
        daily:   acc.daily   + v.earnings.daily,
        weekly:  acc.weekly  + v.earnings.weekly,
        monthly: acc.monthly + v.earnings.monthly,
      }),
      { daily: 0, weekly: 0, monthly: 0 }
    );

    const totalBookings = aggregateBookingCounts(
      [
        ...parkingBookings.map((b) => ({ paidAt: (b.paymentDetails as any)?.paidAt })),
        ...garageBookings.map((b)  => ({ paidAt: (b.paymentDetails as any)?.paidAt })),
        ...residenceBookings.map((b) => ({ paidAt: (b.paymentDetails as any)?.paidAt })),
      ],
      boundaries
    );

    const recentBookings = allVenues
      .flatMap((v) => v.recentBookings)
      .sort((a, b) => new Date(b.from).getTime() - new Date(a.from).getTime())
      .slice(0, 20);

    res.status(200).json(
      new ApiResponse(
        200,
        { totalEarnings, totalBookings, venues: allVenues, recentBookings },
        "Dashboard stats fetched successfully"
      )
    );
  }
);