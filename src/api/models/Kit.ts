import mongoose from "mongoose";
import type { Kit as KitShape } from "../../core/schema/kit.js";

export type KitStatus = "generating" | "ready" | "failed";

export interface KitDoc extends mongoose.Document {
  id: string;
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  inputHash: string;
  input: {
    jd: string;
    companyUrl: string;
    days: number;
  };
  status: KitStatus;
  kit: KitShape | null;
  notes: string[];
  research: {
    hiringText: string;
    discussionText: string;
    briefPages: { url: string; text: string }[];
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const kitSchema = new mongoose.Schema<KitDoc>(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    inputHash: { type: String, required: true },
    input: {
      jd: { type: String, required: true },
      companyUrl: { type: String, required: true },
      days: { type: Number, required: true, min: 1, max: 60 },
    },
    status: {
      type: String,
      enum: ["generating", "ready", "failed"],
      required: true,
      default: "generating",
    },
    kit: { type: mongoose.Schema.Types.Mixed, default: null },
    notes: { type: [String], default: [] },
    research: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false },
);

// One kit per user per exact posting — duplicate submissions return the
// existing kit instead of burning tokens on an identical run.
kitSchema.index({ userId: 1, inputHash: 1 }, { unique: true });

export const KitModel = mongoose.model<KitDoc>("Kit", kitSchema);
