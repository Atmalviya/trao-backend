import mongoose from "mongoose";

/**
 * Per-user practice progress for one kit's flashcards. Confidence is 1–4
 * (1 = no idea, 4 = solid). The next session is ordered by lowest confidence
 * first, ties broken by least-recently-seen; unseen cards sort before
 * everything (see practice service).
 */
export interface CardState {
  cardId: string;
  confidence: number;
  timesSeen: number;
  lastSeenAt: Date;
}

export interface PracticeStateDoc extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  kitId: mongoose.Types.ObjectId;
  cards: CardState[];
  createdAt: Date;
  updatedAt: Date;
}

const cardStateSchema = new mongoose.Schema<CardState>(
  {
    cardId: { type: String, required: true },
    confidence: { type: Number, required: true, min: 1, max: 4 },
    timesSeen: { type: Number, required: true, default: 0 },
    lastSeenAt: { type: Date, required: true },
  },
  { _id: false },
);

const practiceStateSchema = new mongoose.Schema<PracticeStateDoc>(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kitId: { type: mongoose.Schema.Types.ObjectId, ref: "Kit", required: true },
    cards: { type: [cardStateSchema], default: [] },
  },
  { timestamps: true },
);

practiceStateSchema.index({ userId: 1, kitId: 1 }, { unique: true });

export const PracticeState = mongoose.model<PracticeStateDoc>(
  "PracticeState",
  practiceStateSchema,
);
