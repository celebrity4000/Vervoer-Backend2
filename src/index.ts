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

// ── Stripe webhook (needs raw body — must be imported before express.json()) ──
import { stripeWebhook } from "./controllers/Stripe.webhook.controller.js";

dotenv.config({ path: "./.env" });

const app: Application = express();
const httpServer = createServer(app);

console.log("🔑 Stripe key in use:", process.env.STRIPE_SECRET_KEY?.substring(0, 20));

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    "https://admin-self-seven-79.vercel.app",
    "https://vervoer-merchant-dashboad.vercel.app",
    "https://merchant-dashboad.vercel.app",
    "https://vervoer-backend2.onrender.com"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true,
}));

// ─────────────────────────────────────────────────────────────────────────────
// ✅ STRIPE WEBHOOK — must be registered BEFORE express.json()
//    Stripe signs the raw request body; once it is parsed to JSON the
//    signature check will always fail.
// ─────────────────────────────────────────────────────────────────────────────
app.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

// ─────────────────────────────────────────────────────────────────────────────
// Body parsers — AFTER the webhook raw route
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────────────────────────────────────
// Socket.io
// ─────────────────────────────────────────────────────────────────────────────
const io = new Server(httpServer, { cors: { origin: "*" } });

const PORT: number = parseInt(process.env.PORT || "5000", 10);

// ─────────────────────────────────────────────────────────────────────────────
// API routes
// ─────────────────────────────────────────────────────────────────────────────
app.use("/api/users",     userRoutes);
app.use("/api/merchants", merchantRouter);

// ── Stripe public key endpoint ───────────────────────────────────────────────
app.get("/api/getStripePublicKey", (req, res) => {
  try {
    if (!StripePublicKey) {
      return res.status(500).json(new ApiResponse(500, null, "Stripe configuration error"));
    }
    res.status(200).json(new ApiResponse(200, {
      key:         StripePublicKey,
      keyType:     StripePublicKey.startsWith("pk_test_") ? "test" : "live",
      version:     "2.0",
      lastUpdated: new Date().toISOString(),
      keyHash:     StripePublicKey.slice(-10),
    }));
  } catch (error) {
    console.error("Error fetching Stripe key:", error);
    res.status(500).json(new ApiResponse(500, null, "Failed to retrieve Stripe key"));
  }
});

app.get("/", (req: Request, res: Response) => {
  res.status(200).send("Welcome To Vervoer Backend API");
});

// ─────────────────────────────────────────────────────────────────────────────
// Socket.io
// ─────────────────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.on("location", (data) => {
    io.emit("location", { id: socket.id, ...data });
  });
  socket.on("disconnect", () => {
    io.emit("user-disconnected", socket.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Account deletion page for Google Play Console
// ─────────────────────────────────────────────────────────────────────────────
app.get("/delete-account", (req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Delete Account - Vervoer</title>

      <style>
        *{
          margin:0;
          padding:0;
          box-sizing:border-box;
          font-family:Arial,sans-serif;
        }

        body{
          background:#f5f5f5;
          padding:40px 20px;
          color:#333;
        }

        .container{
          max-width:700px;
          margin:auto;
          background:#fff;
          padding:40px;
          border-radius:12px;
          box-shadow:0 0 10px rgba(0,0,0,0.1);
        }

        h1{
          text-align:center;
          margin-bottom:20px;
          color:#111;
        }

        p{
          margin-bottom:15px;
          line-height:1.7;
          font-size:16px;
        }

        .email-box{
          background:#f1f1f1;
          padding:15px;
          border-radius:8px;
          margin-top:20px;
          text-align:center;
          font-weight:bold;
        }

        .btn{
          display:inline-block;
          margin-top:25px;
          padding:12px 24px;
          background:#000;
          color:#fff;
          text-decoration:none;
          border-radius:8px;
        }

        .center{
          text-align:center;
        }

        ul{
          margin-top:10px;
          margin-left:20px;
          line-height:1.8;
        }
      </style>
    </head>

    <body>
      <div class="container">
        <h1>Delete Your Account</h1>

        <p>
          At Vervoer, we respect your privacy and provide users with the ability
          to request permanent deletion of their account and personal data.
        </p>

        <p>
          If you want to delete your account, please send a request using the email below.
        </p>

        <div class="email-box">
          support@vervoerapp.com
        </div>

        <div class="center">
          <a
            href="mailto:support@vervoerapp.com?subject=Account Deletion Request"
            class="btn"
          >
            Request Account Deletion
          </a>
        </div>

        <p style="margin-top:30px;">
          Once your request is received:
        </p>

        <ul>
          <li>Your account will be permanently deleted within 7 working days.</li>
          <li>Your personal information will be removed from our systems.</li>
          <li>Some legal or transaction-related records may be retained if required by law.</li>
        </ul>

        <p style="margin-top:25px;">
          If you have any questions, feel free to contact our support team.
        </p>
      </div>
    </body>
    </html>
  `);
});

// ─────────────────────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────────────────────
connectDB()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log("Server with Socket.io started at", PORT);
    });
    startBookingCleanupJob();
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });