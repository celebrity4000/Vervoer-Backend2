import { Router } from "express";
import {
  bookASlot,
  deleteParking,
  editParkingLot,
  getAvailableSpace,
  getListOfParkingLot,
  getLotBookingById,
  getLotBookingList,
  getParkingLotbyId,
  lotCheckOut,
  registerParkingLot,
  markSlotVacant,
  confirmCashPaymentLot,
} from "../controllers/merchant.parkinglot.controller.js";

import {
  extendGarageBooking,
  confirmGarageExtension,
  confirmGarageExtensionCash,
  extendLotBooking,
  confirmLotExtension,
  confirmLotExtensionCash,
  extendResidenceBooking,
  confirmResidenceExtension,
  confirmResidenceExtensionCash,
} from "../controllers/Extendbooking.controller.js";

import { imageUpload, imageUploadFields } from "../middleware/upload.middleware.js";
import {
  bookGarageSlot,
  checkoutGarageSlot,
  deleteGarage,
  editGarage,
  garageBookingInfo,
  garageBookingList,
  getAvailableGarageSlots,
  getGarageDetails,
  getListOfGarage,
  registerGarage,
  scanBookingQRCode,
  markGarageSlotVacant,
  confirmCashPaymentGarage,
} from "../controllers/merchant.garage.controller.js";
import {
  addResidence,
  deleteResidence,
  getListOfResidence,
  getResidenceById,
  updateResidence,
  deleteResidenceBooking,
  verifyResidenceBooking,
  checkoutResidence,
  residenceBookingInfo,
  residenceBookingList,
  markResidenceSlotVacant,
  confirmCashPaymentResidence,
} from "../controllers/merchant.residence.controller.js";
import { getMerchantStats }      from "../controllers/Merchant.stats.controller.js";
import { updateMonthlySettings } from "../controllers/Merchant.monthly.controller.js";
import { getDryCleanerStats }    from "../controllers/Merchant.drycleaner.stats.js";
import {
  addMerchantSubAccount,
  getMerchantSubAccounts,
  removeMerchantSubAccount,
  subAccountLogin,
  toggleSubAccountStatus,
} from "../controllers/User.js";
import { authenticate } from "../middleware/auth.middleware.js";

// ── Stripe Connect ────────────────────────────────────────────────────────────
import {
  createOrResumeOnboarding,
  getConnectStatus,
  disconnectConnectAccount,
} from "../controllers/merchantStripeConnect.controller.js";

// ── Daily Rate ────────────────────────────────────────────────────────────────
import {
  updateDailyRateSettings,
  getDailyRateSettings,
} from "../controllers/Dailyrate.controller.js";

const merchantRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — sub-account login (no auth required)
// ─────────────────────────────────────────────────────────────────────────────
merchantRouter.post("/sub-account/login", subAccountLogin);

// ─────────────────────────────────────────────────────────────────────────────
// STRIPE CONNECT — merchant payout onboarding
// POST   /api/merchants/connect/onboard     → create Connect account + KYC URL
// GET    /api/merchants/connect/status      → check charges_enabled
// DELETE /api/merchants/connect/disconnect  → unlink account
// ─────────────────────────────────────────────────────────────────────────────
merchantRouter.post("/connect/onboard",      createOrResumeOnboarding);
merchantRouter.get("/connect/status",        getConnectStatus);
merchantRouter.delete("/connect/disconnect", disconnectConnectAccount);

// ─────────────────────────────────────────────────────────────────────────────
// PARKING LOT
// ─────────────────────────────────────────────────────────────────────────────
merchantRouter.post("/parkinglot/registration", imageUpload.array("images", 10), registerParkingLot);
merchantRouter.put("/parkinglot/update/:id",    imageUpload.array("images", 10), editParkingLot);
merchantRouter.delete("/parkinglot/delete/:id", deleteParking);
merchantRouter.get("/parkinglot/getavailable",  getAvailableSpace);
merchantRouter.post("/parkinglot/checkout",     lotCheckOut);
merchantRouter.post("/parkinglot/book",         imageUploadFields, bookASlot);
merchantRouter.get("/parkinglot/booking",       getLotBookingList);
merchantRouter.get("/parkinglot/booking/:id",   getLotBookingById);
merchantRouter.patch("/parkinglot/booking/:id/mark-vacant",   markSlotVacant);
merchantRouter.patch("/parkinglot/booking/:id/confirm-cash",  confirmCashPaymentLot);

merchantRouter.post("/parkinglot/booking/:id/extend",               extendLotBooking);
merchantRouter.patch("/parkinglot/booking/:id/extend/confirm",      confirmLotExtension);
merchantRouter.patch("/parkinglot/booking/:id/extend/confirm-cash", confirmLotExtensionCash);

merchantRouter.get("/parkinglot/search", getListOfParkingLot);
merchantRouter.get("/parkinglot/:id",    getParkingLotbyId);

// ─────────────────────────────────────────────────────────────────────────────
// GARAGE
// ─────────────────────────────────────────────────────────────────────────────
merchantRouter.post("/garage/registration", imageUpload.array("images", 10), registerGarage);
merchantRouter.put("/garage/update/:id",    imageUpload.array("images", 10), editGarage);
merchantRouter.delete("/garage/delete/:id", deleteGarage);
merchantRouter.get("/garage/getavailable",  getAvailableGarageSlots);
merchantRouter.post("/garage/checkout",     checkoutGarageSlot);
merchantRouter.post("/garage/book",         imageUploadFields, bookGarageSlot);
merchantRouter.get("/garage/booking",       garageBookingList);
merchantRouter.get("/garage/booking/:id",   garageBookingInfo);
merchantRouter.patch("/garage/booking/:id/mark-vacant",  markGarageSlotVacant);
merchantRouter.patch("/garage/booking/:id/confirm-cash", confirmCashPaymentGarage);

merchantRouter.post("/garage/booking/:id/extend",               extendGarageBooking);
merchantRouter.patch("/garage/booking/:id/extend/confirm",      confirmGarageExtension);
merchantRouter.patch("/garage/booking/:id/extend/confirm-cash", confirmGarageExtensionCash);

merchantRouter.get("/garage/search",               getListOfGarage);
merchantRouter.get("/api/garage-booking/scan/:id", scanBookingQRCode);
merchantRouter.get("/garage/:id",                  getGarageDetails);

// ─────────────────────────────────────────────────────────────────────────────
// RESIDENCE
// ─────────────────────────────────────────────────────────────────────────────
merchantRouter.post("/residence/registration",              imageUpload.array("images", 10), addResidence);
merchantRouter.put("/residence/update/:residenceId",        imageUpload.array("images", 10), updateResidence);
merchantRouter.delete("/residence/delete/:residenceId",     deleteResidence);
merchantRouter.post("/residence/checkout",                  checkoutResidence);
merchantRouter.post("/residence/book",                      verifyResidenceBooking);
merchantRouter.get("/residence/booking",                    residenceBookingList);
merchantRouter.get("/residence/booking/:id",                residenceBookingInfo);
merchantRouter.patch("/residence/booking/:id/mark-vacant",  markResidenceSlotVacant);
merchantRouter.patch("/residence/booking/:id/confirm-cash", confirmCashPaymentResidence);
merchantRouter.delete("/residence/booking/:bookingId",      deleteResidenceBooking);

merchantRouter.post("/residence/booking/:id/extend",               extendResidenceBooking);
merchantRouter.patch("/residence/booking/:id/extend/confirm",      confirmResidenceExtension);
merchantRouter.patch("/residence/booking/:id/extend/confirm-cash", confirmResidenceExtensionCash);

merchantRouter.get("/residence/search",       getListOfResidence);
merchantRouter.get("/residence/:residenceId", getResidenceById);

// ─────────────────────────────────────────────────────────────────────────────
// MERCHANT-LEVEL ROUTES
// ─────────────────────────────────────────────────────────────────────────────
merchantRouter.get("/stats",              getMerchantStats);
merchantRouter.patch("/monthly-settings", updateMonthlySettings);
merchantRouter.get("/dry-cleaner-stats",  getDryCleanerStats);

// ─────────────────────────────────────────────────────────────────────────────
// DAILY RATE SETTINGS
// PATCH /api/merchants/daily-rate-settings              → merchant: update slots
// GET   /api/merchants/daily-rate-settings/:venueType/:venueId → public: read slots
// ─────────────────────────────────────────────────────────────────────────────
merchantRouter.patch("/daily-rate-settings",                        updateDailyRateSettings);
merchantRouter.get("/daily-rate-settings/:venueType/:venueId",      getDailyRateSettings);

// ─────────────────────────────────────────────────────────────────────────────
// SUB-ACCOUNTS — protected, must come after public routes
// ─────────────────────────────────────────────────────────────────────────────
merchantRouter.use(authenticate);
merchantRouter.get("/sub-accounts",          getMerchantSubAccounts);
merchantRouter.post("/sub-accounts",         addMerchantSubAccount);
merchantRouter.patch("/sub-accounts/toggle", toggleSubAccountStatus);
merchantRouter.delete("/sub-accounts",       removeMerchantSubAccount);

export default merchantRouter;