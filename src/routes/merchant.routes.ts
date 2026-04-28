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
} from "../controllers/merchant.parkinglot.controller.js";
import { imageUpload } from "../middleware/upload.middleware.js";
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
  markGarageSlotVacant, // ✅ NEW
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
  markResidenceSlotVacant, // ✅ NEW
} from "../controllers/merchant.residence.controller.js";
import { imageUploadFields } from "../middleware/upload.middleware.js";
import { getMerchantStats } from "../controllers/Merchant.stats.controller.js";
import { updateMonthlySettings } from "../controllers/Merchant.monthly.controller.js";
import {getDryCleanerStats} from "../controllers/Merchant.drycleaner.stats.js";
import { addMerchantSubAccount, getMerchantSubAccounts, removeMerchantSubAccount, subAccountLogin, toggleSubAccountStatus } from "../controllers/User.js";
import { authenticate } from "../middleware/auth.middleware.js";

const merchantRouter = Router();

// ── Parking Lot ───────────────────────────────────────────────────────────────
merchantRouter.post("/parkinglot/registration", imageUpload.array("images", 10), registerParkingLot);
merchantRouter.put("/parkinglot/update/:id", imageUpload.array("images", 10), editParkingLot);
merchantRouter.delete("/parkinglot/delete/:id", deleteParking);
merchantRouter.get("/parkinglot/getavailable", getAvailableSpace);
merchantRouter.post("/parkinglot/checkout", lotCheckOut);
merchantRouter.post("/parkinglot/book", imageUploadFields, bookASlot);
merchantRouter.get("/parkinglot/booking", getLotBookingList);
merchantRouter.get("/parkinglot/booking/:id", getLotBookingById);
merchantRouter.patch("/parkinglot/booking/:id/mark-vacant", markSlotVacant);       // ✅ existing
merchantRouter.get("/parkinglot/search", getListOfParkingLot);
merchantRouter.get("/parkinglot/:id", getParkingLotbyId);

// ── Garage ────────────────────────────────────────────────────────────────────
merchantRouter.post("/garage/registration", imageUpload.array("images", 10), registerGarage);
merchantRouter.put("/garage/update/:id", imageUpload.array("images", 10), editGarage);
merchantRouter.delete("/garage/delete/:id", deleteGarage);
merchantRouter.get("/garage/getavailable", getAvailableGarageSlots);
merchantRouter.post("/garage/book", imageUploadFields, bookGarageSlot);
merchantRouter.get("/garage/search", getListOfGarage);
merchantRouter.post("/garage/checkout", checkoutGarageSlot);
merchantRouter.get("/garage/booking", garageBookingList);
merchantRouter.get("/garage/booking/:id", garageBookingInfo);
merchantRouter.patch("/garage/booking/:id/mark-vacant", markGarageSlotVacant);     // ✅ NEW
merchantRouter.get("/garage/:id", getGarageDetails);
merchantRouter.get("/api/garage-booking/scan/:id", scanBookingQRCode);

// ── Residence ─────────────────────────────────────────────────────────────────
merchantRouter.post("/residence/registration", imageUpload.array("images", 10), addResidence);
merchantRouter.put("/residence/update/:residenceId", imageUpload.array("images", 10), updateResidence);
merchantRouter.delete("/residence/delete/:residenceId", deleteResidence);
merchantRouter.get("/residence/search", getListOfResidence);
merchantRouter.post("/residence/book", verifyResidenceBooking);
merchantRouter.post("/residence/checkout", checkoutResidence);
merchantRouter.get("/residence/booking", residenceBookingList);
merchantRouter.get("/residence/booking/:id", residenceBookingInfo);
merchantRouter.patch("/residence/booking/:id/mark-vacant", markResidenceSlotVacant); // ✅ NEW
merchantRouter.delete("/residence/booking/:bookingId", deleteResidenceBooking);
merchantRouter.get("/residence/:residenceId", getResidenceById);
merchantRouter.get("/stats", getMerchantStats);
merchantRouter.patch("/monthly-settings", updateMonthlySettings);
merchantRouter.get("/dry-cleaner-stats", getDryCleanerStats);


merchantRouter.post("/sub-account/login", subAccountLogin);
 merchantRouter.use("/sub-accounts", (req, res, next) => {
  console.log("Auth header:", req.headers.authorization);
  next();
});
// Protected — only the primary merchant account can manage sub-accounts
merchantRouter.use(authenticate); // apply your JWT auth middleware
 
merchantRouter.get("/sub-accounts", getMerchantSubAccounts);
merchantRouter.post("/sub-accounts", addMerchantSubAccount);
merchantRouter.patch("/sub-accounts/toggle", toggleSubAccountStatus);
merchantRouter.delete("/sub-accounts", removeMerchantSubAccount);


export default merchantRouter;