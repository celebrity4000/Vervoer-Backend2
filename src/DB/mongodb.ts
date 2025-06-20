import mongoose from "mongoose";

export const connectDB = async (): Promise<void> => {
  try {
    if (!process.env.MONGODB_URI || !process.env.DB_NAME) {
      throw new Error("Missing MONGODB_URL or DB_NAME in environment variables.");
    }

    console.log(`Connecting to DB: ${process.env.MONGODB_URI}/${process.env.DB_NAME}`);

    const connectionInstance = await mongoose.connect(
      `${process.env.MONGODB_URI}/${process.env.DB_NAME}`
    );

    console.log(` Database connected: ${connectionInstance.connection.host}`);
  } catch (error) {
    console.error(" MongoDB connection error:", (error as Error).message);
    process.exit(1);
  }
};
