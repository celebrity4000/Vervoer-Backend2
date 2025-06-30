import express, { Application, Request, Response } from "express";
import dotenv from "dotenv";
import { connectDB } from "./DB/mongodb.js";
import userRoutes from "./routes/routes.js";
import merchantRouter from "./routes/merchant.routes.js";

dotenv.config({
  path: "./.env",
});
console.log(process.env)
const app: Application = express();
const PORT: number = parseInt(process.env.PORT || "5000", 10);

app.use(express.json());

// Hook up your user routes
app.use("/api/users", userRoutes);
app.use("/api/merchants", merchantRouter) ;

app.get("/", (req: Request, res: Response) => {
  res.status(200).send("Welcome To Vervour");
});

// Connect DB and start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(" Server Started at", PORT);
  });
}).catch((err) => {
  console.error(" MongoDB connection error:", err);
});

// Simple route
app.use(express.json());
app.get("/", (req, res) => {
  res.send("Welcome To Vervour").status(200);
});
