import MongoStore from "connect-mongo";
import session from "express-session";
import { config } from "../config.js";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

export function sessionMiddleware() {
  return session({
    name: "prepkit.sid",
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: config.MONGODB_URI,
      ttl: 60 * 60 * 24 * 7,
    }),
    cookie: {
      httpOnly: true,
      sameSite: config.isProduction ? "none" : "lax",
      secure: config.isProduction,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  });
}
