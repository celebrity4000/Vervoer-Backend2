import multer, { FileFilterCallback } from "multer";
import { Request } from "express";

// Storage in memory
const storage = multer.memoryStorage();

// File filter for images only
const imageFileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  if (!file.mimetype.startsWith("image/")) {
    return cb(new Error("Only image files are allowed") as unknown as null, false);
  }
  cb(null, true);
};

// Multer instance for images
export const imageUpload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per image
});

// For multiple images under one or multiple field names:
export const imageUploadFields = imageUpload.fields([
  { name: "shopimage", maxCount: 10 },
  { name: "contactPersonImg", maxCount: 1 },
  { name: "driverLicenseImage", maxCount: 2 },             
  { name: "vehicleInspectionImage", maxCount: 5  },    
  { name: "vehicleInsuranceImage", maxCount: 5 },          
  { name: "driverCertificationImage", maxCount: 5 },       
  { name: "creditCardImage", maxCount: 2 },           
  { name: "localCertificate", maxCount: 5 },   
  { name: "driveProfileImage", maxCount: 1} ,
  { name: "electronicSignature", maxCount: 1 },
  { name: "carLicensePlateImage", maxCount: 1 },
]);

;
