import { Router } from "express";
import { registerUser, verifyOtp,socialRegister, loginUser ,logoutUser,sendForgotPasswordOtp,verifyForgotPasswordOtpHandler,resetForgottenPassword,updateBankDetails,resetUserPassword, uploadProfileImage, editUserProfile, getUserProfile, deleteAccount,getBankDetails} from "../controllers/User.js";  
import { asyncHandler } from "../utils/asynchandler.js";
import { registerDryCleaner, updateDryCleanerProfile,editDryCleanerAddress,editDryCleanerService,editDryCleanerHours,updateDryCleanerShopImages,deleteDryCleanerShopImage,getAllDryCleaners , placeOrderToDryCleaner,getownDrycleaner ,deleteOwnDryCleaner} from "../controllers/merchant.drycleaner.controller.js";
import { createBooking ,bookDriverForDelivery,cancelDriverBooking} from "../controllers/driverBooking.controller.js";
import { imageUploadFields } from "../middleware/upload.middleware.js";
import { authenticate } from "../middleware/auth.middleware.js";
import {completeDriverProfile, getDriverProfile, loginDriver, registerDriverBasic,} from "../controllers/driver.controller.js";
import { sendAdminOtp ,verifyAdminOtp, getAllUsers,getAllMerchants , deleteUser , deleteMerchant, logoutAdmin,updateAdminBankDetails, getMerchantById ,getAllGarages, deleteGarageById ,getGarageById,getAllDryCleaner,getGarageBookingSummary,adminDeleteParking,adminGetBookingsByParkingLot,adminDeleteResidence,getBankDetailsByAdmin} from "../controllers/admin.controller.js";
import { getParkingLotbyId, getListOfParkingLot } from "../controllers/merchant.parkinglot.controller.js";
import { submitQueryToAdmin } from "../controllers/queary.controller.js";
import { createPayment } from "../controllers/paymentGatway.controller.js";
import { isAdmin } from "../middleware/isAdmin.middleware.js";
import { getCurrentSession } from "../controllers/merchant.controller.js";
const router = Router();

// User routes
router.post("/register", asyncHandler(registerUser));
router.post("/verify-otp", asyncHandler(verifyOtp));
router.post("/login", loginUser);
router.post("/logout", authenticate, logoutUser);
router.post("/forgot-password", sendForgotPasswordOtp);
router.post("/verify-forgot-otp", verifyForgotPasswordOtpHandler);
router.post("/reset-password", resetForgottenPassword);
router.put("/reset-user-password", authenticate, resetUserPassword);
router.get("/get-bank-details",authenticate, getBankDetails);

router.delete("/delete-account", authenticate, deleteAccount);
router.put(
  "/upload-profile-image",
  authenticate,
  imageUploadFields,
  uploadProfileImage
);
router.put(
  "/edit-profile",
  authenticate,
  imageUploadFields, 
  editUserProfile
);
router.get("/get-profile", authenticate, getUserProfile);


router.put("/update-bank-details", authenticate, updateBankDetails);


// Dry cleaner registration route with image upload middleware
router.post(
  "/dry-cleaner",  
  authenticate,
  imageUploadFields, 
  registerDryCleaner
);

router.put(
  "/edit-profile-drycleaner/:id", 
  authenticate,
  imageUploadFields, 
  updateDryCleanerProfile
);
router.put("/edit-address-drycleaner/:id", authenticate, editDryCleanerAddress);
router.put("/edit-service-drycleaner/:dryCleanerId", authenticate, editDryCleanerService);
router.put("/edit-hours-drycleaner/:dryCleanerId", authenticate, editDryCleanerHours);
router.get("/get-own-drycleaner", authenticate, getownDrycleaner);
router.delete("/delete-own-drycleaner/:id", authenticate, deleteOwnDryCleaner);

router.put(
  "/update-drycleaner-shop-images/:id",
  authenticate,
  imageUploadFields,
  updateDryCleanerShopImages
);
router.delete(
  "/delete-drycleaner-shop-image/:id",
  authenticate,
  deleteDryCleanerShopImage
);
router.get("/dry-cleaner", getAllDryCleaners);
router.post("/place-order/:dryCleanerId",authenticate, placeOrderToDryCleaner);

// Driver registration route
router.post("/register-driver", registerDriverBasic);

// STEP 2: Complete driver profile (with all required images)
router.post("/complete-profile", authenticate, imageUploadFields, completeDriverProfile);

// Get driver profile (to check completion status)
router.get("/profile", authenticate, getDriverProfile);

// Driver login
router.post("/login", authenticate, loginDriver);
// user booking route
router.post("/create-booking", authenticate, createBooking);
router.post("/book-driver-for-delivery", authenticate, bookDriverForDelivery);
router.delete("/cancel-driver-booking/:id", authenticate, cancelDriverBooking);


// Admin routes
router.post("/admin/send-otp", sendAdminOtp);
router.post("/admin/verify-otp", verifyAdminOtp);
router.get("/admin/get-all-users", isAdmin, getAllUsers);
router.get("/admin/get-all-merchants", isAdmin, getAllMerchants);
router.delete("/admin/delete-user/:userId", isAdmin, deleteUser);
router.delete("/admin/delete-merchant/:merchantId", isAdmin, deleteMerchant);
router.post("/admin/logout", isAdmin, logoutAdmin);
router.put("/admin/update-bank-details", isAdmin, updateAdminBankDetails);
router.get('/admin/get-merchant/:id', isAdmin, getMerchantById);
router.get("/admin/get-all-garages", isAdmin, getAllGarages);
router.delete("/admin/delete-garage/:id", isAdmin, deleteGarageById);
router.get("/admin/get-garage/:id", isAdmin, getGarageById);
router.get("/admin/get-all-dry-cleaners", isAdmin, getAllDryCleaner);
router.get("/admin/get-garage-booking-summary/:garageId", isAdmin, getGarageBookingSummary);
router.get("/admin/get-parking-lot/:id", isAdmin, getParkingLotbyId);
router.get("/admin/get-list-of-parking-lots", isAdmin, getListOfParkingLot);
router.delete("/admin/delete-parking-lot/:id", isAdmin, adminDeleteParking);
router.get("/admin/get-bookings-by-parking-lot/:id", isAdmin, adminGetBookingsByParkingLot);
router.delete("/admin/delete-residence/:id", isAdmin, adminDeleteResidence);
router.get("/admin/get-bank-details/:id", isAdmin, getBankDetailsByAdmin);

// Payment gateway route
router.post("/create-payment", authenticate, createPayment);

router.post("/social-register", socialRegister);

router.get("/current-session", getCurrentSession);
// query route
router.post("/submit-query", authenticate, submitQueryToAdmin);
export default router;

