import { Router } from "express";
import { registerUser, verifyOtp,socialRegister, loginUser ,logoutUser,sendForgotPasswordOtp,verifyForgotPasswordOtpHandler,resetForgottenPassword,updateBankDetails,resetUserPassword, uploadProfileImage, editUserProfile, getUserProfile} from "../controllers/User.js";  
import { asyncHandler } from "../utils/asynchandler.js";
import { registerDryCleaner, updateDryCleanerProfile,editDryCleanerAddress,editDryCleanerService,editDryCleanerHours,updateDryCleanerShopImages,deleteDryCleanerShopImage,getAllDryCleaners , placeOrderToDryCleaner} from "../controllers/merchant.drycleaner.controller.js";
import { createBooking ,bookDriverForDelivery,cancelDriverBooking} from "../controllers/driverBooking.controller.js";
import { imageUploadFields } from "../middleware/upload.middleware.js";
import { authenticate } from "../middleware/auth.middleware.js";
import {registerDriver,} from "../controllers/driver.controller.js";
import { sendAdminOtp ,verifyAdminOtp, getAllUsers,getAllMerchants , deleteUser , deleteMerchant, logoutAdmin,updateAdminBankDetails, getMerchantById ,getAllGarages, deleteGarageById ,getGarageById,getAllDryCleaner,getGarageBookingSummary,adminDeleteParking,adminGetBookingsByParkingLot,adminDeleteResidence} from "../controllers/admin.controller.js";
import { getParkingLotbyId, getListOfParkingLot } from "../controllers/merchant.parkinglot.controller.js";
import { submitQueryToAdmin } from "../controllers/queary.controller.js";
import { createPayment } from "../controllers/paymentGatway.controller.js";
import { isAdmin } from "../middleware/isAdmin.middleware.js";
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
router.get("/dry-cleaner", authenticate, getAllDryCleaners);
router.post("/place-order/:dryCleanerId", authenticate, placeOrderToDryCleaner);
 
// Driver registration route
router.post("/register-driver", imageUploadFields, registerDriver);
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


// Payment gateway route
router.post("/create-payment", authenticate, createPayment);

router.post("/social-register", socialRegister);

// query route
router.post("/submit-query", authenticate, submitQueryToAdmin);
export default router;

