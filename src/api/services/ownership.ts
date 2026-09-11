import { ApiError } from "../errors.js";
import { KitModel, type KitDoc } from "../models/Kit.js";

/** Load a kit and assert the caller owns it. */
export async function ownedKit(userId: string, kitId: string): Promise<KitDoc> {
  if (!/^[a-f0-9]{24}$/i.test(kitId)) {
    throw new ApiError(404, "NOT_FOUND", "Kit not found");
  }
  const kit = await KitModel.findById(kitId);
  if (!kit || String(kit.userId) !== userId) {
    throw new ApiError(404, "NOT_FOUND", "Kit not found");
  }
  return kit;
}

/** Assert the kit is ready to edit. */
export function assertReady(kit: KitDoc): asserts kit is KitDoc & { kit: NonNullable<KitDoc["kit"]> } {
  if (kit.status !== "ready" || !kit.kit) {
    throw new ApiError(409, "KIT_NOT_READY", "Kit is not ready to edit yet");
  }
}
