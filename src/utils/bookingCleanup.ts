import cron from "node-cron";
import { LotRentRecordModel } from "../models/merchant.model.js";
import { ResidenceBookingModel } from "../models/merchant.residence.model.js";
import { GarageBooking } from "../models/merchant.garage.model.js";

export const startBookingCleanupJob = () => {
  cron.schedule("*/30 * * * *", async () => {
    const now = new Date();
    console.log(`🧹 [Cleanup] Running at ${now.toISOString()}`);

    try {
      // ✅ Lot — uses rentTo
      const expiredLot = await LotRentRecordModel.updateMany(
        {
          "paymentDetails.status": "PENDING",
          rentTo: { $lt: now },
        },
        { $set: { "paymentDetails.status": "FAILED" } }
      );
      console.log(`🅿️ Lot cleaned: ${expiredLot.modifiedCount}`);

      // ✅ Residence — uses bookingPeriod.to
      const expiredRes = await ResidenceBookingModel.updateMany(
        {
          "paymentDetails.status": "PENDING",
          "bookingPeriod.to": { $lt: now },
        },
        { $set: { "paymentDetails.status": "FAILED" } }
      );
      console.log(`🏠 Residence cleaned: ${expiredRes.modifiedCount}`);

      // ✅ Garage — uses bookingPeriod.to (NOT rentTo)
      const expiredGarage = await GarageBooking.updateMany(
        {
          "paymentDetails.status": "PENDING",
          "bookingPeriod.to": { $lt: now }, // ← fixed from rentTo
        },
        { $set: { "paymentDetails.status": "FAILED" } }
      );
      console.log(`🚗 Garage cleaned: ${expiredGarage.modifiedCount}`);

    } catch (err) {
      console.error("❌ Booking cleanup error:", err);
    }
  });

  console.log("✅ Booking cleanup job scheduled (every 30 minutes)");
};