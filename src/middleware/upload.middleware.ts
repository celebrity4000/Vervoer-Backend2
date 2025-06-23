import multer from "multer";

const storage = multer.memoryStorage();

export const propertyUpload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (
      file.fieldname === "Lease_document" &&
      !file.mimetype.startsWith("image/")
    ) {
      return cb(
        new Error("Lease_document must be an image") as unknown as null,
        false
      );
    }
    if (file.fieldname === "pdf" && file.mimetype !== "application/pdf") {
      return cb(new Error("pdf must be a PDF file") as unknown as null, false);
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Update fields: multiple images in Lease_document
export const propertyUploadFields = propertyUpload.fields([
  { name: "Lease_document", maxCount: 5 }, // 👈 now accepts up to 5 images
  { name: "pdf", maxCount: 1 },
]);
