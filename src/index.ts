import express, { Application } from "express";
import dotenv from "dotenv";
import { connectDB } from "./DB/mongodb.js";

dotenv.config({
  path: ".env",
});

const app: Application = express();
const PORT: number = parseInt(process.env.PORT || "5000");

// Connect to MongoDB first
connectDB().then(() => {
  // Then start the server
  app.listen(PORT, () => {
    console.log("✅ Server Started at", PORT);
  });
});

// Simple route
app.get("/", (req, res) => {
  res.send("Welcome To Vervour").status(200);
});
