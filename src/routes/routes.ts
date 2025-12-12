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
import {  cancelBooking, cancelBookingRequest, completeTrip, confirmPayment, createBooking, createPaymentIntent, createScheduledBookingRequest, getActiveBooking, getAvailableDriversForScheduling, getBookingDetails, getDriverBookingHistory, getDriverBookingRequests, getDriverScheduledBookings, getOrderReceipt, getUserBookingRequests, getUserBookings, respondToBookingRequest, setAvailabilityStatus, startScheduledTrip, updatePickupAddress,userBokinghistory,generateBookingQRCode, getUserNotifications, markNotificationAsRead, markAllNotificationsAsRead, sendTestNotification, deleteAllNotifications, updateBookingStatus, driverCancelBooking, getMerchantBookings } from "../controllers/driverBooking.controller.js";
import NodeGeocoder from 'node-geocoder';

const router = Router();

// Geocoder configuration
const geocoder = NodeGeocoder({
  provider: 'openstreetmap',
  formatter: null
} as any);

// Haversine formula to calculate distance between coordinates
function calculateDistanceFromCoords(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * 
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ==========================================
// DISTANCE CALCULATION ROUTE - MUST BE FIRST
// ==========================================
router.post("/calculate-distance", async (req: any, res: any) => {
  try {
    const { pickupAddress, dropoffAddress } = req.body;
    
    if (!pickupAddress || !dropoffAddress) {
      return res.status(400).json({
        success: false,
        message: 'Both pickup and dropoff addresses are required'
      });
    }

    console.log('📍 Calculating distance between:');
    console.log('  Pickup:', pickupAddress);
    console.log('  Dropoff:', dropoffAddress);

    // Geocode pickup address
    let pickupResults = await geocoder.geocode(pickupAddress);
    
    // If no results, try simplified address
    if (!pickupResults || pickupResults.length === 0) {
      const parts = pickupAddress.split(',').map((p: string) => p.trim());
      if (parts.length >= 2) {
        const simplified = `${parts[1]}, ${parts[2]}, India`;
        console.log('  🔄 Trying simplified pickup:', simplified);
        pickupResults = await geocoder.geocode(simplified);
      }
    }
    
    if (!pickupResults || pickupResults.length === 0 || !pickupResults[0].latitude || !pickupResults[0].longitude) {
      console.log('  ⚠️ Pickup geocoding failed, using default 10km');
      return res.json({
        success: true,
        data: { distance: 10 },
        message: 'Using default distance - pickup address not found'
      });
    }

    console.log('  ✅ Pickup geocoded:', pickupResults[0].latitude, pickupResults[0].longitude);

    // Wait to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Geocode dropoff address
    let dropoffResults = await geocoder.geocode(dropoffAddress);
    
    if (!dropoffResults || dropoffResults.length === 0) {
      const parts = dropoffAddress.split(',').map((p: string) => p.trim());
      
      // Try multiple fallback strategies
      if (parts.length >= 2) {
        // Strategy 1: Try last 3 parts (usually city, state, country)
        const simplified = `${parts[parts.length - 3] || parts[0]}, ${parts[parts.length - 2]}, India`;
        console.log('  🔄 Trying simplified dropoff (strategy 1):', simplified);
        dropoffResults = await geocoder.geocode(simplified);
      }
      
      // Strategy 2: If still no results, try just city and state
      if ((!dropoffResults || dropoffResults.length === 0) && parts.length >= 2) {
        const cityState = `${parts[parts.length - 2]}, India`;
        console.log('  🔄 Trying city-only dropoff (strategy 2):', cityState);
        await new Promise(resolve => setTimeout(resolve, 1000));
        dropoffResults = await geocoder.geocode(cityState);
      }
    }

    if (!dropoffResults || dropoffResults.length === 0 || !dropoffResults[0].latitude || !dropoffResults[0].longitude) {
      console.log('  ⚠️ Dropoff geocoding failed, using default 10km');
      return res.json({
        success: true,
        data: { distance: 10 },
        message: 'Using default distance - dropoff address not found'
      });
    }

    console.log('  ✅ Dropoff geocoded:', dropoffResults[0].latitude, dropoffResults[0].longitude);

    // Calculate distance using Haversine formula
    const distance = calculateDistanceFromCoords(
      pickupResults[0].latitude,
      pickupResults[0].longitude,
      dropoffResults[0].latitude,
      dropoffResults[0].longitude
    );

    const roundedDistance = Math.max(1, parseFloat(distance.toFixed(2)));

    console.log('  ✅ Distance calculated:', roundedDistance, 'km');

    res.json({
      success: true,
      data: {
        distance: roundedDistance,
        pickup: {
          lat: pickupResults[0].latitude,
          lng: pickupResults[0].longitude,
          formattedAddress: pickupResults[0].formattedAddress
        },
        dropoff: {
          lat: dropoffResults[0].latitude,
          lng: dropoffResults[0].longitude,
          formattedAddress: dropoffResults[0].formattedAddress
        }
      },
      message: 'Distance calculated successfully'
    });

  } catch (error: any) {
    console.error('❌ Distance calculation error:', error);
    res.json({
      success: true,
      data: { distance: 10 },
      message: 'Using default distance due to error: ' + error.message
    });
  }
});

// ==========================================
// USER ROUTES
// ==========================================
router.post("/register", asyncHandler(registerUser));
router.post("/verify-otp", asyncHandler(verifyOtp));
router.post("/login", loginUser);
router.post("/logout", authenticate, logoutUser);
router.post("/forgot-password", sendForgotPasswordOtp);
router.post("/verify-forgot-otp", verifyForgotPasswordOtpHandler);
router.post("/reset-password", resetForgottenPassword);
router.put("/reset-user-password", authenticate, resetUserPassword);
router.get("/get-bank-details", authenticate, getBankDetails);
router.delete("/delete-account", authenticate, deleteAccount);
router.put("/upload-profile-image", authenticate, imageUploadFields, uploadProfileImage);
router.put("/edit-profile", authenticate, imageUploadFields, editUserProfile);
router.get("/get-profile", authenticate, getUserProfile);
router.put("/update-bank-details", authenticate, updateBankDetails);

// ==========================================
// DRY CLEANER ROUTES
// ==========================================
router.post("/dry-cleaner", authenticate, imageUploadFields, registerDryCleaner);
router.put("/edit-profile-drycleaner/:id", authenticate, imageUploadFields, updateDryCleanerProfile);
router.put("/edit-address-drycleaner/:id", authenticate, editDryCleanerAddress);
router.put("/edit-service-drycleaner/:dryCleanerId", authenticate, editDryCleanerService);
router.put("/edit-hours-drycleaner/:dryCleanerId", authenticate, editDryCleanerHours);
router.get("/get-own-drycleaner", authenticate, getownDrycleaner);
router.delete("/delete-own-drycleaner/:id", authenticate, deleteOwnDryCleaner);
router.get("/dry-cleaners/:dryCleanerId/services", getDryCleanerServices);
router.post("/place-drycleaner-order", authenticate, PlaceDryCleanerOrder);
router.put("/update-drycleaner-shop-images/:id", authenticate, imageUploadFields, updateDryCleanerShopImages);
router.delete("/delete-drycleaner-shop-image/:id", authenticate, deleteDryCleanerShopImage);
router.get("/dry-cleaner", getAllDryCleaners);

// ==========================================
// DRIVER ROUTES
// ==========================================
router.post("/register-driver", registerDriverBasic);
router.post('/update-vehicle', authenticate, imageUploadFields, updateVehicleInfo);
router.post('/update-personal-info', authenticate, imageUploadFields, updateDriverPersonalInfo);
router.post('/bank-details', authenticate, imageUploadFields, createDriverBankDetails);
router.get('/attestation/status', authenticate, getDriverAttestationStatus);
router.post('/attestation/submit', authenticate, imageUploadFields, submitDriverAttestation);
router.post('/upload-profile-photo', authenticate, imageUploadFields, uploadDriverProfilePhoto);
router.post("/complete-profile", authenticate, imageUploadFields, completeDriverProfile);
router.get("/driver/profile", authenticate, getDriverProfile);

// ==========================================
// BOOKING ROUTES
// ==========================================
router.post("/create", createBooking);
router.get("/my-bookings", authenticate, userBokinghistory);
router.post("/scheduled-request", createScheduledBookingRequest);
router.get("/available-drivers", getAvailableDriversForScheduling);
router.get("/user/requests", getUserBookingRequests);
router.patch("/user/cancel/:id", cancelBookingRequest);

// Driver booking routes
router.get("/driver/requests", getDriverBookingRequests);
router.put("/driver/respond", respondToBookingRequest);
router.get("/driver/scheduled", getDriverScheduledBookings);
router.patch("/driver/start-trip/:id", startScheduledTrip);
router.patch("/driver/complete-trip/:id", completeTrip);
router.get("/driver/active", getActiveBooking);
router.patch("/driver/availability", setAvailabilityStatus);
router.get("/driver/history", getDriverBookingHistory);

// ==========================================
// PAYMENT ROUTES
// ==========================================
router.post("/payment-intent", createPaymentIntent);
router.post("/confirm-payment", confirmPayment);
router.post("/create-payment", authenticate, createPayment);

// ==========================================
// ADMIN ROUTES
// ==========================================
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

// ==========================================
// OTHER ROUTES
// ==========================================
// Add this route in your merchant routes or main routes file:
router.get("/merchants/bookings", getMerchantBookings);
router.get("/merchant-bookings/:bookingId", authenticate, getBookingDetails);
// The controller is provided in the artifact above
router.post("/social-register", socialRegister);
router.get("/current-session", getCurrentSession);
router.post("/submit-query", authenticate, submitQueryToAdmin);
router.get("/", getUserBookings);

// ==========================================
// SPECIFIC ROUTES (before parameterized routes)
// ==========================================
router.get('/orders/:orderId/receipt', authenticate, getOrderReceipt);
router.put('/bookings/:bookingId/pickup-address', authenticate, updatePickupAddress);
router.get('/bookings/:id/generate-qr', authenticate, generateBookingQRCode);
router.get('/notifications', authenticate, getUserNotifications);
router.put('/mark-all-read', markAllNotificationsAsRead);
router.post('/test', sendTestNotification);
router.delete('/delete-all', deleteAllNotifications);
router.put('/update-status', authenticate,updateBookingStatus);
router.put('/driver-cancel', driverCancelBooking);
router.put('/:notificationId/read', markNotificationAsRead);

// ==========================================
// PARAMETERIZED ROUTES - MUST BE LAST!
// ==========================================
router.get("/bookings/:bookingId", getBookingDetails);
router.post("/bookings/:bookingId/cancel", cancelBooking);

export default router;