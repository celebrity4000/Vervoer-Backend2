import express, { Application, Request, Response } from "express";
import cors from "cors";  
import dotenv from "dotenv";
import { connectDB } from "./DB/mongodb.js";
import { createServer } from "http";
import { Server } from "socket.io";
import userRoutes from "./routes/routes.js";
import merchantRouter from "./routes/merchant.routes.js";

dotenv.config({
  path: "./.env",
});

const app: Application = express();
const httpServer = createServer(app);

// CORS middleware here ⬇️
app.use(cors({
  origin: "http://localhost:5173", 
  credentials: true
}));

const io = new Server(httpServer, {
  cors: {
    origin: "*",  
  },
});

const PORT: number = parseInt(process.env.PORT || "5000", 10);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/users", userRoutes);
app.use("/api/merchants", merchantRouter);

app.get("/", (req: Request, res: Response) => {
  res.status(200).send("Welcome To Vervoer");
});

connectDB()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log("Server with Socket.io started at", PORT);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });

// Socket.io logic
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("location", (data) => {
    console.log("Received location from", socket.id, data);
    io.emit("location", { id: socket.id, ...data });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    io.emit("user-disconnected", socket.id);
  });
});
