import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { validateBody } from "../middleware/validate.js";
import { User } from "../models/User.js";

const credentialsSchema = z.object({
  email: z.email("A valid email is required"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export const authRouter = Router();

function loginSession(req: { session: any }, userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err: unknown) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.save((saveErr: unknown) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

authRouter.post("/register", validateBody(credentialsSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof credentialsSchema>;

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    throw new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ email, passwordHash });

  await loginSession(req, user.id);
  res.status(201).json({ user: { id: user.id, email: user.email } });
});

authRouter.post("/login", validateBody(credentialsSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof credentialsSchema>;

  const user = await User.findOne({ email });
  const valid = user && (await bcrypt.compare(password, user.passwordHash));
  if (!valid) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Incorrect email or password");
  }

  await loginSession(req, user.id);
  res.json({ user: { id: user.id, email: user.email } });
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("prepkit.sid");
    res.status(204).end();
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId).lean();
  if (!user) {
    req.session.destroy(() => {});
    throw new ApiError(401, "UNAUTHENTICATED", "Session is no longer valid");
  }
  res.json({ user: { id: String(user._id), email: user.email } });
});
