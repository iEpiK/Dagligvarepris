import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./auth/routes";
import { connectionsRouter } from "./routes/connections";
import { productsRouter } from "./routes/products";
import { startScheduler } from "./jobs/scheduler";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/auth", authRouter);
app.use("/connections", connectionsRouter);
app.use("/products", productsRouter);

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`Backend kjører på :${port}`);
  startScheduler();
});
