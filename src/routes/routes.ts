import { Router } from "express";
import { registerUser, verifyOtp,socialRegister, loginUser ,logoutUser,sendForgotPasswordOtp,verifyForgotPasswordOtpHandler,resetForgottenPassword,updateBankDetails,resetUserPassword, uploadProfileImage, editUserProfile, getUserProfile, deleteAccount,getBankDetails} from "../controllers/User.js";  
import { asyncHandler } from "../utils/asynchandler.js";
import { registerDryCleaner, updateDryCleanerProfile,editDryCleanerAddress,editDryCleanerService,editDryCleanerHours,updateDryCleanerShopImages,deleteDryCleanerShopImage,getAllDryCleaners ,getownDrycleaner ,deleteOwnDryCleaner, getDryCleanerServices} from "../controllers/merchant.drycleaner.controller.js";

import { imageUploadFields } from "../middleware/upload.middleware.js";
import { authenticate } from "../middleware/auth.middleware.js";
import {completeDriverProfile, getDriverProfile, registerDriverBasic,updateDriverPersonalInfo,updateVehicleInfo, createDriverBankDetails, getDriverAttestationStatus, submitDriverAttestation, uploadDriverProfilePhoto} from "../controllers/driver.controller.js";
import { sendAdminOtp ,verifyAdminOtp, getAllUsers,getAllMerchants , deleteUser , deleteMerchant, logoutAdmin,updateAdminBankDetails, getMerchantById ,getAllGarages, deleteGarageById ,getGarageById,getAllDryCleaner,getGarageBookingSummary,adminDeleteParking,adminGetBookingsByParkingLot,adminDeleteResidence,getBankDetailsByAdmin, setGlobalPricing,getGlobalPricing} from "../controllers/admin.controller.js";
import { getParkingLotbyId, getListOfParkingLot } from "../controllers/merchant.parkinglot.controller.js";
import { submitQueryToAdmin } from "../controllers/queary.controller.js";
import { createPayment } from "../controllers/paymentGatway.controller.js";
import { isAdmin } from "../middleware/isAdmin.middleware.js";
import { getCurrentSession } from "../controllers/merchant.controller.js";
import {PlaceDryCleanerOrder} from "../controllers/DryCleanerBooking.controller.js";
import {  cancelBooking, cancelBookingRequest, completeTrip, confirmPayment, createBooking, createPaymentIntent, createScheduledBookingRequest, getActiveBooking, getAvailableDriversForScheduling, getBookingDetails, getDriverBookingHistory, getDriverBookingRequests, getDriverScheduledBookings, getOrderReceipt, getUserBookingRequests, getUserBookings, respondToBookingRequest, setAvailabilityStatus, startScheduledTrip, updatePickupAddress,userBokinghistory,generateBookingQRCode } from "../controllers/driverBooking.controller.js";

const router = Router();


router.get("/my-bookings", authenticate, userBokinghistory);
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
router.get("/dry-cleaners/:dryCleanerId/services", getDryCleanerServices);
router.post("/place-drycleaner-order", authenticate, PlaceDryCleanerOrder);

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

// Driver registration route
router.post("/register-driver", registerDriverBasic);

router.post('/update-vehicle', authenticate, imageUploadFields, updateVehicleInfo);

router.post('/update-personal-info', authenticate, imageUploadFields, updateDriverPersonalInfo);
router.post('/bank-details', authenticate, imageUploadFields, createDriverBankDetails);
router.get('/attestation/status',authenticate, getDriverAttestationStatus);
router.post('/attestation/submit',authenticate, imageUploadFields, submitDriverAttestation);
router.post('/upload-profile-photo',authenticate, imageUploadFields, uploadDriverProfilePhoto);

//  Complete driver profile (with all required images)
router.post("/complete-profile", authenticate, imageUploadFields, completeDriverProfile);

// Get driver profile (to check completion status)
router.get("/driver/profile", authenticate, getDriverProfile);

// Driver login
// router.post("/login", authenticate, loginDriver);

// Create a scheduled booking request
router.post("/scheduled-request", createScheduledBookingRequest);

// Get available drivers for a specific date/time
router.get("/available-drivers", getAvailableDriversForScheduling);

// Get user's booking requests (with filters)
router.get("/user/requests", getUserBookingRequests);

// Cancel a booking request
router.patch("/user/cancel/:id", cancelBookingRequest);

// ===== DRIVER ROUTES =====

// Get driver's booking requests (pending and all)
router.get("/driver/requests", getDriverBookingRequests);

// Respond to a booking request (accept/reject)
router.put("/driver/respond", respondToBookingRequest);

// Get driver's scheduled bookings (today/upcoming)
router.get("/driver/scheduled", getDriverScheduledBookings);

// Start a scheduled trip
router.patch("/driver/start-trip/:id", startScheduledTrip);

// Complete a trip
router.patch("/driver/complete-trip/:id", completeTrip);

// Get current active booking
router.get("/driver/active", getActiveBooking);

// Set driver availability status
router.patch("/driver/availability", setAvailabilityStatus);

// Get driver's booking history
router.get("/driver/history", getDriverBookingHistory);



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
router.post("/admin/get-current-price-per-km", isAdmin, setGlobalPricing);
router.get("/admin/get-global-pricing", getGlobalPricing);
// Payment gateway route
router.post("/create-payment", authenticate, createPayment);

router.post("/social-register", socialRegister);

router.get("/current-session", getCurrentSession);
// query route
router.post("/submit-query", authenticate, submitQueryToAdmin);

router.post("/create", createBooking);                 // Create a new booking
router.get("/", getUserBookings);                      // Get all user bookings
router.get("/:bookingId", getBookingDetails);          // Get booking details
router.post("/:bookingId/cancel", cancelBooking);      // Cancel booking

router.post("/payment-intent", createPaymentIntent);   // Create Stripe payment intent
router.post("/confirm-payment", confirmPayment);       // Confirm Stripe payment

router.get("/my-bookings", authenticate, userBokinghistory);
    // Specific route first
router.get('/orders/:orderId/receipt', authenticate,getOrderReceipt);        // Specific pattern
router.put('/bookings/:bookingId/pickup-address',authenticate, updatePickupAddress); // Parameterized route last
router.get('/bookings/:id/generate-qr', authenticate, generateBookingQRCode); 
export default router;


