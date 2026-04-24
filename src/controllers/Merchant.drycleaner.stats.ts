import { Request, Response } from "express";
import mongoose from "mongoose";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import { DryCleaner } from "../models/merchant.model.js";
import { Booking } from "../models/booking.model.js";

// ─────────────────────────────────────────────────────────────
// Date boundary helpers (same pattern as getMerchantStats)
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

// ─────────────────────────────────────────────────────────────
// Category breakdown helper
// ─────────────────────────────────────────────────────────────

interface CategoryBreakdown {
  category: string;
  totalOrders: number;
  totalRevenue: number;
  totalItems: number;
}

function buildCategoryBreakdown(bookings: any[]): CategoryBreakdown[] {
  const map = new Map<string, CategoryBreakdown>();

  for (const booking of bookings) {
    const items: any[] = booking.orderItems ?? [];
    for (const item of items) {
      const cat = item.category ?? "Other";
      const existing = map.get(cat) ?? { category: cat, totalOrders: 0, totalRevenue: 0, totalItems: 0 };
      existing.totalItems += item.quantity ?? 1;
      existing.totalRevenue += Number(item.effectivePrice ?? item.price ?? 0) * (item.quantity ?? 1);
      map.set(cat, existing);
    }
    // Count unique orders per category (once per booking that has that category)
    const seenCats = new Set<string>();
    for (const item of items) {
      const cat = item.category ?? "Other";
      if (!seenCats.has(cat)) {
        const entry = map.get(cat)!;
        entry.totalOrders++;
        seenCats.add(cat);
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);
}

// ─────────────────────────────────────────────────────────────
// Status pipeline helper
// ─────────────────────────────────────────────────────────────

interface StatusBreakdown {
  status: string;
  count: number;
}

function buildStatusBreakdown(bookings: any[]): StatusBreakdown[] {
  const map = new Map<string, number>();
  for (const b of bookings) {
    map.set(b.status, (map.get(b.status) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

// ─────────────────────────────────────────────────────────────
// Main handler — GET /merchants/dry-cleaner-stats
// ─────────────────────────────────────────────────────────────

export const getDryCleanerStats = asyncHandler(
  async (req: Request, res: Response) => {
    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "merchant" || !verifiedAuth.user) {
      throw new ApiError(401, "UNAUTHORIZED");
    }
    const merchantId = verifiedAuth.user._id as mongoose.Types.ObjectId;

    const boundaries = getDateBoundaries();

    // ── 1. Fetch all dry cleaners owned by this merchant ──────
    const dryCleaners = await DryCleaner.find({ owner: merchantId }).lean();

    if (dryCleaners.length === 0) {
      res.status(200).json(
        new ApiResponse(200, {
          totalEarnings: { daily: 0, weekly: 0, monthly: 0 },
          totalBookings: { daily: 0, weekly: 0, monthly: 0 },
          shops: [],
          recentOrders: [],
          categoryBreakdown: [],
          statusBreakdown: [],
          overallStats: {
            totalShops: 0,
            totalServices: 0,
            totalOrdersAllTime: 0,
            avgOrderValue: 0,
          },
        }, "No dry cleaners found for this merchant")
      );
      return;
    }

    const dryCleanerIds = dryCleaners.map((dc) => dc._id);

    // ── 2. Fetch all bookings for these dry cleaners ──────────
    //    "paid" bookings = paymentStatus "paid" | "completed"
    const allBookings = await Booking.find({
      dryCleaner: { $in: dryCleanerIds },
    })
      .populate("user", "firstName lastName email phoneNumber")
      .lean();

    const paidBookings = allBookings.filter((b: any) =>
      ["paid", "completed"].includes(b.paymentStatus)
    );

    // ── 3. Per-shop breakdown ─────────────────────────────────
    const shops = dryCleaners.map((dc) => {
      const shopBookings = allBookings.filter(
        (b: any) => b.dryCleaner?.toString() === dc._id.toString()
      );
      const shopPaidBookings = shopBookings.filter((b: any) =>
        ["paid", "completed"].includes(b.paymentStatus)
      );

      // Earnings — use pricing.totalAmount as the canonical amount
      const earningsRecords = shopPaidBookings.map((b: any) => ({
        paidAt: b.paidAt ?? b.updatedAt ?? null,
        amount: Number(b.pricing?.totalAmount ?? 0),
      }));
      const earnings = aggregateEarnings(earningsRecords, boundaries);

      // Booking counts (paid only)
      const bookingCountRecords = shopPaidBookings.map((b: any) => ({
        paidAt: b.paidAt ?? b.updatedAt ?? null,
      }));
      const bookingCounts = aggregateBookingCounts(bookingCountRecords, boundaries);

      // Currently active orders (picked up, in progress)
      const activeStatuses = ["accepted", "in_progress", "pickup_completed", "en_route_to_dropoff", "arrived_at_dropoff", "dropped_at_center"];
      const activeOrders = shopBookings.filter((b: any) =>
        activeStatuses.includes(b.status)
      ).length;

      // Ready for delivery
      const readyForDelivery = shopBookings.filter(
        (b: any) => b.status === "ready_for_delivery"
      ).length;

      // Pending (not yet accepted)
      const pendingOrders = shopBookings.filter(
        (b: any) => b.status === "pending"
      ).length;

      // Services summary
      const totalServices = (dc.services ?? []).length;
      const servicesByCategory: Record<string, number> = {};
      for (const svc of dc.services ?? []) {
        const cat = (svc as any).category ?? "Other";
        servicesByCategory[cat] = (servicesByCategory[cat] ?? 0) + 1;
      }

      // Recent 5 orders for this shop
      const recentOrders = [...shopBookings]
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5)
        .map((b: any) => {
          const customer = b.user as any;
          return {
            _id: b._id.toString(),
            orderNumber: b.orderNumber ?? "—",
            customerName: customer
              ? `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim()
              : "Unknown",
            customerPhone: customer?.phoneNumber ?? "",
            status: b.status,
            paymentStatus: b.paymentStatus,
            totalAmount: Number(b.pricing?.totalAmount ?? 0),
            itemCount: (b.orderItems ?? []).reduce(
              (sum: number, item: any) => sum + (item.quantity ?? 1),
              0
            ),
            scheduledPickup: b.scheduledPickupDateTime ?? null,
            scheduledDelivery: b.scheduledDeliveryDateTime ?? null,
            createdAt: b.createdAt,
            type: "dryCleaning" as const,
          };
        });

      // All-time total revenue for this shop
      const allTimeRevenue = shopPaidBookings.reduce(
        (sum: number, b: any) => sum + Number(b.pricing?.totalAmount ?? 0),
        0
      );

      return {
        id: dc._id.toString(),
        shopname: (dc as any).shopname ?? "Unnamed Shop",
        address: (dc as any).address ?? {},
        phoneNumber: (dc as any).phoneNumber ?? "",
        contactPerson: (dc as any).contactPerson ?? "",
        contactPersonImg: (dc as any).contactPersonImg ?? null,
        shopimage: (dc as any).shopimage ?? [],
        rating: (dc as any).rating ?? 0,
        about: (dc as any).about ?? "",
        earnings,
        bookingCounts,
        orderStatus: {
          pending: pendingOrders,
          active: activeOrders,
          readyForDelivery,
          total: shopBookings.length,
          paid: shopPaidBookings.length,
        },
        totalServices,
        servicesByCategory,
        allTimeRevenue,
        recentOrders,
        type: "dryCleaning" as const,
      };
    });

    // ── 4. Aggregate totals across all shops ──────────────────
    const totalEarnings = aggregateEarnings(
      paidBookings.map((b: any) => ({
        paidAt: b.paidAt ?? b.updatedAt ?? null,
        amount: Number(b.pricing?.totalAmount ?? 0),
      })),
      boundaries
    );

    const totalBookings = aggregateBookingCounts(
      paidBookings.map((b: any) => ({
        paidAt: b.paidAt ?? b.updatedAt ?? null,
      })),
      boundaries
    );

    // ── 5. Category breakdown (all shops combined) ────────────
    const categoryBreakdown = buildCategoryBreakdown(paidBookings);

    // ── 6. Status breakdown (all bookings, not just paid) ─────
    const statusBreakdown = buildStatusBreakdown(allBookings);

    // ── 7. Overall stats ──────────────────────────────────────
    const totalOrdersAllTime = paidBookings.length;
    const totalRevenueAllTime = paidBookings.reduce(
      (sum: number, b: any) => sum + Number(b.pricing?.totalAmount ?? 0),
      0
    );
    const avgOrderValue =
      totalOrdersAllTime > 0
        ? Math.round((totalRevenueAllTime / totalOrdersAllTime) * 100) / 100
        : 0;

    const totalServicesAcrossShops = dryCleaners.reduce(
      (sum, dc) => sum + (dc.services ?? []).length,
      0
    );

    // ── 8. Recent orders across all shops (top 20) ────────────
    const recentOrders = shops
      .flatMap((s) => s.recentOrders)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);

    res.status(200).json(
      new ApiResponse(
        200,
        {
          totalEarnings,
          totalBookings,
          shops,
          recentOrders,
          categoryBreakdown,
          statusBreakdown,
          overallStats: {
            totalShops: dryCleaners.length,
            totalServices: totalServicesAcrossShops,
            totalOrdersAllTime,
            avgOrderValue,
          },
        },
        "Dry cleaner dashboard stats fetched successfully"
      )
    );
  }
);