import { config } from "./config.js";
import { createApp } from "./app.js";
import { connectDb } from "./api/db.js";

async function main() {
  await connectDb();
  const app = createApp();
  app.listen(config.PORT, () => {
    console.log(`API listening on http://localhost:${config.PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
