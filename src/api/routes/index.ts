import { Router } from "express";
import { authRouter } from "./auth.js";
import { builderRouter } from "./kitBuilder.js";
import { kitsRouter } from "./kits.js";
import { practiceRouter } from "./practice.js";

export { authRouter } from "./auth.js";
export { builderRouter } from "./kitBuilder.js";
export { kitsRouter } from "./kits.js";
export { practiceRouter } from "./practice.js";

export const appRouter = Router();

appRouter.use("/auth", authRouter);
appRouter.use("/kits", builderRouter);
appRouter.use("/kits", practiceRouter);
appRouter.use("/kits", kitsRouter);
