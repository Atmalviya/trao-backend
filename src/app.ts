import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { errorHandler, notFoundHandler } from "./api/errors.js";
import { appRouter } from "./api/routes/index.js";
import { sessionMiddleware } from "./api/session.js";

export function createApp() {
  const app = express();

  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(sessionMiddleware());

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use(appRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
