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

import { getMerchantStats } from "../controllers/Merchant.stats.controller.js";
import { updateMonthlySettings } from "../controllers/Merchant.monthly.controller.js";
import { getDryCleanerStats } from "../controllers/Merchant.drycleaner.stats.js";

import {
  addMerchantSubAccount,
  getMerchantSubAccounts,
  removeMerchantSubAccount,
  subAccountLogin,
  toggleSubAccountStatus,
} from "../controllers/User.js";

import { authenticate } from "../middleware/auth.middleware.js";

// Stripe Connect
import {
  createOrResumeOnboarding,
  getConnectStatus,
  disconnectConnectAccount,
} from "../controllers/merchantStripeConnect.controller.js";

// Daily Rate
import {
  updateDailyRateSettings,
  getDailyRateSettings,
} from "../controllers/Dailyrate.controller.js";

const merchantRouter = Router();

// ============================================================================
// PUBLIC ROUTES (NO AUTHENTICATION REQUIRED)
// ============================================================================

// Sub-account login
merchantRouter.post("/sub-account/login", subAccountLogin);

// ============================================================================
// ALL ROUTES BELOW REQUIRE AUTHENTICATION
// ============================================================================
merchantRouter.use(authenticate);

// ============================================================================
// STRIPE CONNECT ROUTES (PROTECTED)
// ============================================================================

// ✅ FIX: Moved AFTER authenticate so req.user is available in the controller
merchantRouter.post("/connect/onboard", createOrResumeOnboarding);
merchantRouter.get("/connect/status", getConnectStatus);
merchantRouter.delete("/connect/disconnect", disconnectConnectAccount);

// ============================================================================
// PARKING LOT ROUTES
// ============================================================================

merchantRouter.post(
  "/parkinglot/registration",
  imageUpload.array("images", 10),
  registerParkingLot
);

merchantRouter.put(
  "/parkinglot/update/:id",
  imageUpload.array("images", 10),
  editParkingLot
);

merchantRouter.delete("/parkinglot/delete/:id", deleteParking);
merchantRouter.get("/parkinglot/getavailable", getAvailableSpace);
merchantRouter.post("/parkinglot/checkout", lotCheckOut);

merchantRouter.post(
  "/parkinglot/book",
  imageUploadFields,
  bookASlot
);

merchantRouter.get("/parkinglot/booking", getLotBookingList);
merchantRouter.get("/parkinglot/booking/:id", getLotBookingById);

merchantRouter.patch(
  "/parkinglot/booking/:id/mark-vacant",
  markSlotVacant
);

merchantRouter.patch(
  "/parkinglot/booking/:id/confirm-cash",
  confirmCashPaymentLot
);

// Booking extensions
merchantRouter.post(
  "/parkinglot/booking/:id/extend",
  extendLotBooking
);

merchantRouter.patch(
  "/parkinglot/booking/:id/extend/confirm",
  confirmLotExtension
);

merchantRouter.patch(
  "/parkinglot/booking/:id/extend/confirm-cash",
  confirmLotExtensionCash
);

// Search and details
merchantRouter.get("/parkinglot/search", getListOfParkingLot);
merchantRouter.get("/parkinglot/:id", getParkingLotbyId);

// ============================================================================
// GARAGE ROUTES
// ============================================================================

merchantRouter.post(
  "/garage/registration",
  imageUpload.array("images", 10),
  registerGarage
);

merchantRouter.put(
  "/garage/update/:id",
  imageUpload.array("images", 10),
  editGarage
);

merchantRouter.delete("/garage/delete/:id", deleteGarage);
merchantRouter.get("/garage/getavailable", getAvailableGarageSlots);
merchantRouter.post("/garage/checkout", checkoutGarageSlot);

merchantRouter.post(
  "/garage/book",
  imageUploadFields,
  bookGarageSlot
);

merchantRouter.get("/garage/booking", garageBookingList);
merchantRouter.get("/garage/booking/:id", garageBookingInfo);

merchantRouter.patch(
  "/garage/booking/:id/mark-vacant",
  markGarageSlotVacant
);

merchantRouter.patch(
  "/garage/booking/:id/confirm-cash",
  confirmCashPaymentGarage
);

// Booking extensions
merchantRouter.post(
  "/garage/booking/:id/extend",
  extendGarageBooking
);

merchantRouter.patch(
  "/garage/booking/:id/extend/confirm",
  confirmGarageExtension
);

merchantRouter.patch(
  "/garage/booking/:id/extend/confirm-cash",
  confirmGarageExtensionCash
);

// Search and details
merchantRouter.get("/garage/search", getListOfGarage);
merchantRouter.get("/api/garage-booking/scan/:id", scanBookingQRCode);
merchantRouter.get("/garage/:id", getGarageDetails);

// ============================================================================
// RESIDENCE ROUTES
// ============================================================================

merchantRouter.post(
  "/residence/registration",
  imageUpload.array("images", 10),
  addResidence
);

merchantRouter.put(
  "/residence/update/:residenceId",
  imageUpload.array("images", 10),
  updateResidence
);

merchantRouter.delete(
  "/residence/delete/:residenceId",
  deleteResidence
);

merchantRouter.post("/residence/checkout", checkoutResidence);
merchantRouter.post("/residence/book", verifyResidenceBooking);

merchantRouter.get("/residence/booking", residenceBookingList);
merchantRouter.get("/residence/booking/:id", residenceBookingInfo);

merchantRouter.patch(
  "/residence/booking/:id/mark-vacant",
  markResidenceSlotVacant
);

merchantRouter.patch(
  "/residence/booking/:id/confirm-cash",
  confirmCashPaymentResidence
);

merchantRouter.delete(
  "/residence/booking/:bookingId",
  deleteResidenceBooking
);

// Booking extensions
merchantRouter.post(
  "/residence/booking/:id/extend",
  extendResidenceBooking
);

merchantRouter.patch(
  "/residence/booking/:id/extend/confirm",
  confirmResidenceExtension
);

merchantRouter.patch(
  "/residence/booking/:id/extend/confirm-cash",
  confirmResidenceExtensionCash
);

// Search and details
merchantRouter.get("/residence/search", getListOfResidence);
merchantRouter.get("/residence/:residenceId", getResidenceById);

// ============================================================================
// MERCHANT-LEVEL ROUTES
// ============================================================================

merchantRouter.get("/stats", getMerchantStats);
merchantRouter.patch("/monthly-settings", updateMonthlySettings);
merchantRouter.get("/dry-cleaner-stats", getDryCleanerStats);

// ============================================================================
// DAILY RATE SETTINGS
// ============================================================================

merchantRouter.patch(
  "/daily-rate-settings",
  updateDailyRateSettings
);

merchantRouter.get(
  "/daily-rate-settings/:venueType/:venueId",
  getDailyRateSettings
);

// ============================================================================
// SUB-ACCOUNT MANAGEMENT (PROTECTED)
// ============================================================================

merchantRouter.get("/sub-accounts", getMerchantSubAccounts);
merchantRouter.post("/sub-accounts", addMerchantSubAccount);
merchantRouter.patch("/sub-accounts/toggle", toggleSubAccountStatus);
merchantRouter.delete("/sub-accounts", removeMerchantSubAccount);

export default merchantRouter;