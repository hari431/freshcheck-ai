import "dotenv/config";
import express from "express";
import cors from "cors";
import checkRouter from "./routes/check.js";

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api", checkRouter);

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`FreshCheck API listening on http://localhost:${PORT}`);
  });
}

export default app;