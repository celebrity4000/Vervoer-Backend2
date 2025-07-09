import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
interface CloudinaryUploadResponse {
  secure_url: string;
  public_id: string;
}
console.log({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})
export const deleteFromCloudinary = async function (public_id:string) {

  return new Promise<void>((res , rej) =>
  cloudinary.uploader.destroy(public_id,{resource_type: "image"},(err)=>{
    if(err)rej(err) ;
    res();
  }))
}
const uploadToCloudinary = async (
  buffer: Buffer
): Promise<CloudinaryUploadResponse> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: "auto" },
      (error, result) => {
        if (error || !result) {
          console.error("Cloudinary Upload Error:", error);
          return reject(new Error("Failed to upload to Cloudinary"));
        }
        console.log("File uploaded to Cloudinary:", result.secure_url);
        resolve(result);
      }
    );

    Readable.from(buffer).pipe(uploadStream);
  });
};
export default uploadToCloudinary;
