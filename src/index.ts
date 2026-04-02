import express, { Application, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./DB/mongodb.js";
import { createServer } from "http";
import { Server } from "socket.io";
import userRoutes from "./routes/routes.js";
import merchantRouter from "./routes/merchant.routes.js";
import { ApiResponse } from "./utils/apirespone.js";
import { StripePublicKey } from "./utils/stripePayments.js";
import { startBookingCleanupJob } from "./utils/bookingCleanup.js"; 

dotenv.config({ path: "./.env" });

const app: Application = express();
const httpServer = createServer(app);

console.log("🔑 Stripe key in use:", process.env.STRIPE_SECRET_KEY?.substring(0, 20));

app.use(cors({
  origin: ["http://localhost:5173", "https://admin-self-seven-79.vercel.app"],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true,
}));

const io = new Server(httpServer, { cors: { origin: "*" } });

const PORT: number = parseInt(process.env.PORT || "5000", 10);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/users", userRoutes);
app.use("/api/merchants", merchantRouter);

// ✅ Single Stripe key endpoint (removed duplicate)
app.get("/api/getStripePublicKey", (req, res) => {
  try {
    if (!StripePublicKey) {
      return res.status(500).json(new ApiResponse(500, null, "Stripe configuration error"));
    }
    res.status(200).json(new ApiResponse(200, {
      key: StripePublicKey,
      keyType: StripePublicKey.startsWith("pk_test_") ? "test" : "live",
      version: "2.0",
      lastUpdated: new Date().toISOString(),
      keyHash: StripePublicKey.slice(-10),
    }));
  } catch (error) {
    console.error("Error fetching Stripe key:", error);
    res.status(500).json(new ApiResponse(500, null, "Failed to retrieve Stripe key"));
  }
});

app.get("/", (req: Request, res: Response) => {
  res.status(200).send("Welcome To Vervoer Backend API");
});

// Socket.io
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.on("location", (data) => {
    io.emit("location", { id: socket.id, ...data });
  });
  socket.on("disconnect", () => {
    io.emit("user-disconnected", socket.id);
  });
});

// ✅ Start server + cleanup job after DB connects
connectDB()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log("Server with Socket.io started at", PORT);
    });
    startBookingCleanupJob(); // ✅ starts after DB is ready
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });